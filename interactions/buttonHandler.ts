import { EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonBuilder, type ButtonInteraction, type Client, MessageFlags } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import config from "../config.ts";
import * as S from "../src/ui/strings.ts";
import { requestPlayback } from "../src/usecases/addTracks.ts";
import { channelResponder } from "../src/usecases/responders.ts";
import { checkControl, checkAdd, checkSummon } from "../src/usecases/permissions.ts";
import * as controls from "../src/usecases/controls.ts";
import { controlMessage } from "../src/ui/controlMessages.ts";

const LOOP_TEXT: Record<string, [emoji: string, message: string]> = {
  track: ["🔂", "반복 모드가 **트랙 반복**으로 설정되었습니다. 현재 곡이 계속 재생됩니다."],
  queue: ["🔁", "반복 모드가 **대기열 반복**으로 설정되었습니다. 대기열이 끝나면 다시 시작됩니다."],
  false: ["➡️", "반복 모드가 이제 **꺼졌습니다**"],
};
import { PANEL, HELP, SYSTEM, SEARCH, customId, partsOf } from "../src/ui/customIds.ts";
import { showFailureWith } from "../src/ui/failureNotice.ts";
import { queueView, queueInfoOf, pageOf, PAGE_PREFIX } from "../src/ui/queueView.ts";
import { buildHelpEmbed } from "../commands/help.ts";
import { buildSystemEmbed } from "../commands/system.ts";
import { route, type Route } from "./route.ts";
import type { Player } from "../src/player/Player.ts";
import { colorOf } from "../src/ui/colors.ts";

/** 서버 메시지의 버튼 */
type Press = ButtonInteraction<"cached">;

const VIDEO_ID = /^[\w-]{11}$/;

// 재생 패널의 버튼. custom_id 는 panel:동작:세션
const PANEL_ACTIONS: Record<string, (it: Press, player: Player) => unknown> = {
  pause: (it, player) => handlePause(it, player),
  skip: (it, player) => handleSkip(it, player),
  stop: (it, player) => handleStop(it, player),
  queue: (it, player) => handleQueue(it, player),
  shuffle: (it, player) => handleShuffle(it, player),
  highlight: (it, player) => handleHighlight(it, player),
  volume: (it) => handleVolumeModal(it),
  loop: (it, player) => handleLoop(it, player),
  previous: (it, player) => handlePrevious(it, player),
};

// 재생 패널의 버튼. 플레이어가 있고 패널의 세션이 지금 세션이어야 한다.
// 재적 · 계층 검사는 처리기가 부르는 controls 가 한다. 대기열 보기는 검사 없이 연다
async function handlePanelButton(interaction: Press) {
  const player = interaction.client.players.get(interaction.guild.id);
  if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: MessageFlags.Ephemeral });

  const { action, rest } = partsOf(interaction.customId);
  const sessionId = rest[0];
  if (sessionId && player.sessionId && sessionId !== player.sessionId) {
    return interaction.reply({ content: S.ERR_SESSION_INVALID, flags: MessageFlags.Ephemeral });
  }
  const handle = PANEL_ACTIONS[action];
  if (!handle) return interaction.reply({ content: S.ERR_UNKNOWN_INTERACTION, flags: MessageFlags.Ephemeral });
  await handle(interaction, player);
}

async function handlePause(interaction: Press, player: Player) {
  const r = await controls.pause(player, { member: interaction.member });
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  const message = r.paused ? "음악 일시정지됨" : "음악 재개됨";
  const emoji = r.paused ? "⏸️" : "▶️";
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${message}`)
    .setDescription(`**[${r.track.title}](${r.track.pageUrl})** ${message}!`)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .addFields({ name: "👤 작업자", value: `${interaction.member}`, inline: true });

  if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSkip(interaction: Press, player: Player) {
  const r = await controls.skip(player, { member: interaction.member });
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  if (r.restarted) {
    return await interaction.reply({
      content: `🔂 한곡 반복 중. **${r.track.title}**을(를) 처음부터 다시 재생합니다! (다음 곡으로 가려면 반복을 해제하세요)`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("⏭️ 노래 건너뜀")
    .setDescription(`**[${r.track.title}](${r.track.pageUrl})** 건너뜀!`)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .addFields({ name: "👤 건너뛴 사람", value: `${interaction.member}`, inline: true });

  if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handlePrevious(interaction: Press, player: Player) {
  const r = await controls.previous(player, { member: interaction.member });
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  await interaction.reply({
    content: r.restarted ? "🔂 한곡 반복 중. 현재 곡을 처음부터 다시 재생합니다!" : "⏮️ 이전 노래로 이동했습니다!",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStop(interaction: Press, player: Player) {
  const r = await controls.stop(player, { member: interaction.member });
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setTitle("⏹️ 음악 중지됨")
    .setDescription(`${r.track ? `**[${r.track.title}](${r.track.pageUrl})**` : "Music"} 중지됨!`)
    .setColor(colorOf("closed"))
    .setTimestamp()
    .addFields({ name: "👤 중지한 사람", value: `${interaction.member}`, inline: true });

  if (r.cleared > 0) embed.setFooter({ text: `대기열에서 ${r.cleared}개의 노래가 제거되었습니다` });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleQueue(interaction: Press, player: Player) {
  const queueInfo = queueInfoOf(player);

  if (!queueInfo.current && queueInfo.queue.length === 0) {
    return await interaction.reply({
      content: S.ERR_NO_SONGS_IN_QUEUE,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({ ...queueView(queueInfo), flags: MessageFlags.Ephemeral });
}

// 대기열 넘기기(◀ ▶). 버튼이 달린 대기열 메시지를 그때의 대기열로 다시 그린다. 플레이어나 곡이 없으면 그렇다고 고친다
async function handleQueuePage(interaction: Press) {
  const player = interaction.client.players.get(interaction.guild.id);
  const info = player ? queueInfoOf(player) : null;
  if (!info || (!info.current && info.queue.length === 0)) {
    return interaction.update({ content: player ? S.ERR_NO_SONGS_IN_QUEUE : S.ERR_NO_MUSIC, embeds: [], components: [] });
  }
  return interaction.update(queueView(info, pageOf(interaction.customId) ?? 1));
}

async function handleShuffle(interaction: Press, player: Player) {
  const r = await controls.shuffle(player, { member: interaction.member });
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  const embed = new EmbedBuilder()
    .setTitle("🔀 대기열 셔플됨")
    .setDescription(`${r.count}개의 노래가 셔플되었습니다!`)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .addFields({ name: "👤 셔플한 사람", value: `${interaction.member}`, inline: true });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleHighlight(interaction: Press, player: Player) {
  const r = await controls.highlight(player, { member: interaction.member }, { onAccepted: () => interaction.deferReply({ flags: MessageFlags.Ephemeral }) });
  // 버튼은 하이라이트가 없으면 비활성이라 곡이 바뀌기 직전의 늦은 클릭뿐이다. 조용히 넘긴다
  if (!r.ok && r.code === "no-highlight") return interaction.deferUpdate();
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });
  await interaction.editReply({ content: "✨ 하이라이트 지점으로 이동했어요." });
}

async function handleVolumeModal(interaction: Press) {
  const permErr = await checkControl(interaction.member);
  if (permErr) {
    return await interaction.reply({
      content: permErr,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.showModal(volumeModal());
}

/** 음량을 적는 모달. 받는 쪽은 modalHandler 의 음량 처리 */
function volumeModal() {
  const volumeInput = new TextInputBuilder().setCustomId("volume_input").setLabel("볼륨 (0-100)").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3).setPlaceholder("50").setRequired(true);
  return new ModalBuilder().setCustomId(customId(PANEL, "volume")).setTitle("볼륨 설정").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(volumeInput));
}

async function handleLoop(interaction: Press, player: Player) {
  // 순환: 끔 → 한곡 → 대기열 → 끔. 라이브가 있으면 "끄기"에만 응한다
  const r = await controls.loop(player, { member: interaction.member }, controls.nextLoopMode(player.loop));
  if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: MessageFlags.Ephemeral });

  const [modeEmoji, modeMessage] = LOOP_TEXT[String(r.mode)];
  const embed = new EmbedBuilder()
    .setTitle(`${modeEmoji} 🔁 반복 모드 변경됨`)
    .setDescription(modeMessage)
    .setColor(colorOf("brand"))
    .setTimestamp()
    .addFields({ name: "👤 변경한 사람", value: `${interaction.member}`, inline: true });

  if (r.track?.thumbnail) embed.setThumbnail(r.track.thumbnail);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** 새로 그린 화면 */
type Built = { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> };

// 새로고침 버튼: 버튼이 달린 메시지를 새 내용으로 고친다
async function refreshMessage(interaction: Press, build: (client: Client<true>) => Built | Promise<Built>, { failed, notice }: { failed: string; notice: string }) {
  try {
    await interaction.deferUpdate();
    const { embed, row } = await build(interaction.client);
    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    log.error(failed, error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: notice, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.followUp({ content: notice, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      log.error("오류 안내 전송 실패:", err);
    }
  }
}

function handleHelpRefresh(interaction: Press) {
  return refreshMessage(interaction, (client) => buildHelpEmbed(client), { failed: "명령어 도움말 새로고침 실패:", notice: "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!" });
}

async function handleSystemRefresh(interaction: Press) {
  // /system과 동일하게 봇 운영자 전용
  if (interaction.user.id !== config.dashboard.ownerId) {
    return await interaction.reply({ content: "❌ 봇 운영자만 사용할 수 있습니다!", flags: MessageFlags.Ephemeral });
  }
  return refreshMessage(interaction, (client) => buildSystemEmbed(client), { failed: "시스템 정보 새로고침 실패:", notice: "❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!" });
}

// 검색 결과 고르기 · 취소. 검색한 사람만 누를 수 있다. 고른 영상은 다시 찾는다(받아 둔 곡이면 캐시에서)
async function handleSearchInteraction(interaction: Press, client: Client<true>) {
  const { member, guild } = interaction;
  const { action, rest } = partsOf(interaction.customId);
  const [userId, position, videoId = ""] = rest;

  if (userId !== interaction.user.id) {
    return await interaction.reply({ content: "❌ 검색을 요청한 사용자만 선택할 수 있습니다!", flags: MessageFlags.Ephemeral });
  }

  if (action === "cancel") {
    const embed = new EmbedBuilder().setTitle("❌ 검색 취소됨").setDescription("검색이 취소되었습니다.").setColor(colorOf("closed")).setTimestamp();
    return await interaction.update({ embeds: [embed], components: [] });
  }
  if (action !== "pick" || !VIDEO_ID.test(videoId)) return await interaction.reply({ content: S.ERR_UNKNOWN_INTERACTION, flags: MessageFlags.Ephemeral });

  // 곡 추가 경로. /play · /search 와 같은 검사
  const permErr = checkAdd(member) || checkSummon(member);
  if (permErr) return await interaction.reply({ content: permErr, flags: MessageFlags.Ephemeral });

  await interaction.deferUpdate();

  const processingEmbed = new EmbedBuilder().setTitle("🔄 처리 중...").setDescription("고른 곡을 추가하는 중...").setColor(colorOf("working")).setTimestamp();

  await interaction.editReply({ embeds: [processingEmbed], components: [] });
  // 여기서부터 던지면 "처리 중" 자리를 오류로 바꾼다
  showFailureWith(interaction, (notice) => interaction.editReply({ embeds: [errorEmbed(notice)], components: [] }));

  // 안내는 채널로, 자리표시자는 이 상호작용의 "처리 중" 응답.
  // 검색 메시지는 일반 임베드라 CV2 현재 재생 메시지로 수정할 수 없다.
  const responder = channelResponder(interaction.channel, () =>
    interaction.deleteReply().catch(() => {
      /* 이미 지워졌다 */
    }),
  );

  const result = await requestPlayback(client, {
    guild,
    requester: member,
    query: `https://www.youtube.com/watch?v=${videoId}`,
    textChannel: interaction.channel,
    voiceChannel: member.voice.channel ?? null,
    responder,
    source: `/search ${position}번째`,
  });
  if (!result.success) return await interaction.editReply({ embeds: [errorEmbed(result.message)], components: [] });

  // 검색 결과 메시지 제거. 현재 재생/대기열 정보는 별도로 전송됨
  await responder.dismissPlaceholder();
}

const errorEmbed = (message: string) => new EmbedBuilder().setTitle("❌ 오류").setDescription(message).setColor(colorOf("error")).setTimestamp();

// custom_id 앞머리로 가른다. 플레이어 없이도 눌리는 것(검색 · 새로고침 · 자동재생 · 대기열 넘기기)과 재생 패널의 버튼.
// 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다
const routes: Route[] = [
  route("button", customId(SEARCH, ""), (it) => handleSearchInteraction(it, it.client)),
  route("button", customId(HELP, "refresh"), handleHelpRefresh),
  route("button", customId(SYSTEM, "refresh"), handleSystemRefresh),
  route("button", PAGE_PREFIX, handleQueuePage),
  // 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다. 재생 패널의 다른 버튼보다 좁다
  route("button", customId(PANEL, ""), handlePanelButton),
];

export { routes, handlePanelButton, handlePause, handleSkip, handlePrevious, handleStop, handleQueue, handleQueuePage, handleShuffle, handleHighlight, handleVolumeModal, volumeModal, handleLoop, refreshMessage, handleHelpRefresh, handleSystemRefresh, handleSearchInteraction };
