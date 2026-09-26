import { Events, EmbedBuilder, MessageFlags, type Client, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import config from "../config.ts";
import logger from "../src/infra/log/logger.ts";
import { messageOf } from "../src/rules/errorKind.ts";
const log = logger.child({ category: "events" });
import * as genreConfig from "../src/config/genres.ts";
import * as S from "../src/ui/strings.ts";
import { checkControl } from "../src/usecases/permissions.ts";
import { expireReply } from "../src/ui/replyLifetime.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";
import { volumeChanged } from "../src/ui/volumeReply.ts";
import type { ClientEvent } from "../src/app/main.ts";

async function handleAutoplayGenre(interaction: StringSelectMenuInteraction<"cached">, client: Client<true>) {
  const guild = interaction.guild;
  const member = interaction.member;

  // 음악 플레이어 가져오기
  const player = client.players.get(guild.id);
  if (!player) {
    return await interaction.reply({
      content: S.ERR_NO_MUSIC,
      flags: [1 << 6],
    });
  }

  // 자동재생 설정은 재생 조작. DJ 계층 + 재적 규칙 (모더레이터 면제)
  const permErr = await checkControl(member);
  if (permErr) {
    return await interaction.reply({
      content: permErr,
      flags: [1 << 6],
    });
  }

  const selectedGenre = interaction.values[0];

  // 알 수 없는 장르 처리
  const { genres } = genreConfig.genres();
  if (!genres[selectedGenre]) {
    return await interaction.reply({
      content: `❌ 알 수 없는 장르입니다: \`${selectedGenre}\`. 자동재생 버튼을 다시 눌러 선택해 주세요.`,
      flags: [1 << 6],
    });
  }

  // 선택한 장르로 자동재생 활성화
  player.setAutoplay(selectedGenre);

  const genreName = selectedGenre; // 키가 곧 이름
  const embed = new EmbedBuilder()
    .setTitle("🎲 자동 재생이 활성화되었습니다")
    .setDescription(`**${genreName}** 장르로 자동 재생이 설정되었습니다. 대기열이 끝나면 자동으로 재생됩니다.`)
    .setColor(config.bot.embedColor)
    .setTimestamp()
    .addFields({
      name: "👤 변경한 사람",
      value: `${member}`,
      inline: true,
    });

  // 선택 메뉴를 결과로 덮는다. reply로 새 메시지를 만들면 고른 뒤에도 선택 화면이 남는다.
  // update는 ephemeral을 기록하지 않아 정리에서 빠지므로, 지우라고 선언해 둔다.
  expireReply(interaction);
  await interaction.update({ embeds: [embed], components: [] });

  // 아무것도 틀고 있지 않으면 그 자리에서 첫 곡을 뽑아 재생한다. 틀고 있으면 지금 곡이 끝난 뒤에
  // 이어지므로 건드리지 않는다(다음 곡은 play()가 미리 뽑아 둔다).
  if (!player.currentTrack) {
    await player.handleAutoplay();
    return;
  }

  // 자동재생이 활성화되었음을 표시하도록 메인 임베드 갱신
  if (client.musicEmbedManager) {
    await client.musicEmbedManager.updateNowPlayingEmbed(player);
  }
}

async function handleJumpTo(interaction: StringSelectMenuInteraction<"cached">, client: Client<true>) {
  const player = client.players.get(interaction.guild.id);
  const [, , sessionId] = interaction.customId.split(":");
  if (player && sessionId && player.sessionId && sessionId !== player.sessionId) {
    return await interaction.reply({
      content: S.ERR_SESSION_INVALID,
      flags: [1 << 6],
    });
  }

  const r = await controls.jump(player, { member: interaction.member }, Number(interaction.values[0]));
  if (!r.ok && r.code === "bad-position") return await interaction.reply({ content: "❌ 선택한 곡을 대기열에서 찾을 수 없습니다!", flags: [1 << 6] });
  if (!r.ok) return await interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

  await interaction.reply({
    content: `⏭️ **${r.track.title}**로 이동했습니다!`,
    flags: [1 << 6],
  });
}

async function handleVolumeModal(interaction: ModalSubmitInteraction<"cached">, client: Client<true>) {
  // 숫자만 받는다. parseInt 는 "50abc" 를 50 으로 읽는다. 범위는 controls.volume 이 본다
  const raw = interaction.fields.getTextInputValue("volume_input").trim();
  const volume = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  const r = await controls.volume(client.players.get(interaction.guild.id), { member: interaction.member }, volume);
  if (!r.ok) return await interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  await interaction.reply({ embeds: [volumeChanged({ before: r.before, level: r.level, by: interaction.member })], flags: MessageFlags.Ephemeral });
}

const exported: ClientEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;
    if (!interaction.inCachedGuild()) return;
    // 다른 처리기가 맡는 것. 재생목록 더 넣기(playlistMoreHandler.ts) · SponsorBlock 설정(sponsorConfigHandler.ts)
    if (/^(plmm?|sb):/.test(interaction.customId)) return;

    const client = interaction.client;

    try {
      // 선택 메뉴 처리
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith("autoplay_genre:")) {
          await handleAutoplayGenre(interaction, client);
          return;
        }
        if (interaction.customId.startsWith("music_jumpto:")) {
          await handleJumpTo(interaction, client);
          return;
        }
      }

      // 모달 처리
      if (interaction.isModalSubmit() && interaction.customId === "volume_modal") {
        await handleVolumeModal(interaction, client);
        return;
      }
      await interaction.reply({
        content: "❌ 알 수 없는 모달!",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      log.error(`모달 · 선택 메뉴 처리 실패(${interaction.customId}):`, error);
      if (interaction.replied || interaction.deferred) return;
      await interaction.reply({ content: S.ERR_PROCESSING, flags: MessageFlags.Ephemeral }).catch((replyError) => log.warn(`오류 안내 전송 실패: ${messageOf(replyError)}`));
    }
  },
};
export default exported;
export { handleAutoplayGenre, handleJumpTo, handleVolumeModal };
