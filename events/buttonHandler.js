import { Events, EmbedBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import logger from "../src/infra/log/logger.ts";
const log = logger.child({ category: "events" });
import config from "../config.ts";
import S from "../src/ui/strings.js";
import addTracks from "../src/usecases/addTracks.js";
const { requestPlayback, ensurePlayer } = addTracks;
import responders from "../src/usecases/responders.js";
const { channelResponder } = responders;
import permissions from "../src/usecases/permissions.js";
const { checkControl, checkAdd, checkSummon } = permissions;
import controls from "../src/usecases/controls.js";
import controlMessages from "../src/ui/controlMessages.js";
const { controlMessage } = controlMessages;

const LOOP_TEXT = {
  track: ["🔂", "반복 모드가 **트랙 반복**으로 설정되었습니다. 현재 곡이 계속 재생됩니다."],
  queue: ["🔁", "반복 모드가 **대기열 반복**으로 설정되었습니다. 대기열이 끝나면 다시 시작됩니다."],
  false: ["➡️", "반복 모드가 이제 **꺼졌습니다**"],
};
import genreMenu from "../src/ui/genreMenu.js";
const { buildGenreMenu, buildAutoplayOffMenu, OFF_MENU_MS } = genreMenu;
import replyLifetime from "../src/ui/replyLifetime.js";
const { keepReply, expireReply } = replyLifetime;
import queueDisplay from "../src/ui/queueDisplay.js";
const { queueLine } = queueDisplay;
import helpCommand from "../commands/help.js";
import systemCommand from "../commands/system.js";

// customId 앞머리로 가르는 버튼. 플레이어 없이도 눌린다. null 은 다른 처리기(djRoleConfigHandler · sponsorConfigHandler)가 받는다.
// 자동재생은 놀고 있을 때도 켤 수 있어 끝난 패널의 버튼도 여기로 온다
const FREE = [
  ["djrole:", null],
  ["sb:", null],
  ["search_", (h, it) => h.handleSearchInteraction(it, it.client)],
  ["help_refresh", (h, it) => h.handleHelpRefresh(it)],
  ["system_refresh", (h, it) => h.handleSystemRefresh(it)],
  ["music_autoplay:", (h, it) => h.handleAutoplayButton(it)],
];

// 재생 패널의 버튼. customId 는 "이름:요청자:세션"
const PANEL = {
  music_pause: (h, it, player) => h.handlePause(it, player),
  music_skip: (h, it, player) => h.handleSkip(it, player),
  music_stop: (h, it, player) => h.handleStop(it, player),
  music_queue: (h, it, player) => h.handleQueue(it, player),
  music_shuffle: (h, it, player) => h.handleShuffle(it, player),
  music_highlight: (h, it, player) => h.handleHighlight(it, player),
  music_volume: (h, it) => h.handleVolumeModal(it),
  music_loop: (h, it, player) => h.handleLoop(it, player),
  music_previous: (h, it, player) => h.handlePrevious(it, player),
};

const exported = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton()) return;
    const route = FREE.find(([prefix]) => interaction.customId.startsWith(prefix));
    if (route) return route[1]?.(this, interaction);
    return this.handlePanelButton(interaction);
  },

  // 재생 패널의 버튼. 플레이어가 있고 패널의 세션이 지금 세션이어야 한다.
  // 재적 · 계층 검사는 처리기가 부르는 controls 가 한다. 대기열 보기는 검사 없이 연다
  async handlePanelButton(interaction) {
    const player = interaction.client.players.get(interaction.guild.id);
    if (!player) return interaction.reply({ content: S.ERR_NO_MUSIC, flags: [1 << 6] });

    try {
      const [name, , sessionId] = interaction.customId.split(":");
      if (sessionId && player.sessionId && sessionId !== player.sessionId) {
        return await interaction.reply({ content: S.ERR_SESSION_INVALID, flags: [1 << 6] });
      }
      const handle = PANEL[name];
      if (!handle) return await interaction.reply({ content: "❌ 알 수 없는 상호작용!", flags: [1 << 6] });
      await handle(this, interaction, player);
    } catch (error) {
      log.error(`패널 버튼 처리 실패(${interaction.customId}):`, error);
      if (interaction.replied || interaction.deferred) return;
      await interaction.reply({ content: S.ERR_PROCESSING, flags: [1 << 6] }).catch((replyError) => log.warn(`오류 안내 전송 실패: ${replyError.message}`));
    }
  },

  async handlePause(interaction, player) {
    const r = await controls.pause(player, { member: interaction.member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const message = r.paused ? "음악 일시정지됨" : "음악 재개됨";
    const emoji = r.paused ? "⏸️" : "▶️";
    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${message}`)
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})** ${message}!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 작업자", value: `${interaction.member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  async handleSkip(interaction, player) {
    const r = await controls.skip(player, { member: interaction.member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    if (r.restarted) {
      return await interaction.reply({
        content: `🔂 한곡 반복 중. **${r.track.title}**을(를) 처음부터 다시 재생합니다! (다음 곡으로 가려면 반복을 해제하세요)`,
        flags: [1 << 6],
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("⏭️ 노래 건너뜀")
      .setDescription(`**[${r.track.title}](${r.track.pageUrl})** 건너뜀!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 건너뛴 사람", value: `${interaction.member}`, inline: true });

    if (r.track.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  async handlePrevious(interaction, player) {
    const r = await controls.previous(player, { member: interaction.member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    await interaction.reply({
      content: r.restarted ? "🔂 한곡 반복 중. 현재 곡을 처음부터 다시 재생합니다!" : "⏮️ 이전 노래로 이동했습니다!",
      flags: [1 << 6],
    });
  },

  async handleStop(interaction, player) {
    const r = await controls.stop(player, { member: interaction.member }, interaction.client.players);
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("⏹️ 음악 중지됨")
      .setDescription(`${r.track ? `**[${r.track.title}](${r.track.pageUrl})**` : "Music"} 중지됨!`)
      .setColor("#FF0000")
      .setTimestamp()
      .addFields({ name: "👤 중지한 사람", value: `${interaction.member}`, inline: true });

    if (r.cleared > 0) embed.setFooter({ text: `대기열에서 ${r.cleared}개의 노래가 제거되었습니다` });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  async handleQueue(interaction, player) {
    const queueInfo = player.getQueue();

    if (!queueInfo.current && queueInfo.queue.length === 0) {
      return await interaction.reply({
        content: S.ERR_NO_SONGS_IN_QUEUE,
        flags: [1 << 6],
      });
    }

    const embed = new EmbedBuilder().setTitle("📝 재생 대기열").setColor(config.bot.embedColor).setTimestamp();

    if (queueInfo.current) {
      embed.addFields({
        name: "🎵 현재 재생 중",
        value: `**[${queueInfo.current.title}](${queueInfo.current.pageUrl})**`,
        inline: false,
      });
    }

    if (queueInfo.queue.length > 0) {
      let queueText = "";
      const tracks = queueInfo.queue.slice(0, 10);

      tracks.forEach((track, index) => {
        queueText += queueLine(track, index + 1);
      });

      if (queueInfo.queue.length > 10) {
        queueText += `\n*... 그리고 ${queueInfo.queue.length - 10}개 더*`;
      }

      embed.addFields({
        name: `📋 다음 노래들 (${queueInfo.queue.length}개)`,
        value: queueText,
        inline: false,
      });
    }

    embed.setFooter({
      text: `총 ${queueInfo.queue.length + (queueInfo.current ? 1 : 0)}개의 노래`,
    });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  async handleHighlight(interaction, player) {
    const r = await controls.highlight(player, { member: interaction.member }, { onAccepted: () => interaction.deferReply({ flags: [1 << 6] }) });
    // 버튼은 하이라이트가 없으면 비활성이라 곡이 바뀌기 직전의 늦은 클릭뿐이다. 조용히 넘긴다
    if (r.code === "no-highlight") return interaction.deferUpdate();
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });
    await interaction.editReply({ content: "✨ 하이라이트 지점으로 이동했어요." });
  },

  async handleShuffle(interaction, player) {
    const r = await controls.shuffle(player, { member: interaction.member });
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const embed = new EmbedBuilder()
      .setTitle("🔀 대기열 셔플됨")
      .setDescription(`${r.count}개의 노래가 셔플되었습니다!`)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 셔플한 사람", value: `${interaction.member}`, inline: true });

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  async handleVolumeModal(interaction) {
    const permErr = await checkControl(interaction.member);
    if (permErr) {
      return await interaction.reply({
        content: permErr,
        flags: [1 << 6],
      });
    }

    const modal = new ModalBuilder().setCustomId("volume_modal").setTitle("볼륨 설정");

    const volumeInput = new TextInputBuilder().setCustomId("volume_input").setLabel("볼륨 (0-100)").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(3).setPlaceholder("50").setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(volumeInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  },

  async handleLoop(interaction, player) {
    // 순환: 끔 → 한곡 → 대기열 → 끔. 라이브가 있으면 "끄기"에만 응한다
    const r = await controls.loop(player, { member: interaction.member }, controls.nextLoopMode(player.loop));
    if (!r.ok) return interaction.reply({ content: controlMessage(r), flags: [1 << 6] });

    const [modeEmoji, modeMessage] = LOOP_TEXT[String(r.mode)];
    const embed = new EmbedBuilder()
      .setTitle(`${modeEmoji} 🔁 반복 모드 변경됨`)
      .setDescription(modeMessage)
      .setColor(config.bot.embedColor)
      .setTimestamp()
      .addFields({ name: "👤 변경한 사람", value: `${interaction.member}`, inline: true });

    if (r.track?.thumbnail) embed.setThumbnail(r.track.thumbnail);

    await interaction.reply({ embeds: [embed], flags: [1 << 6] });
  },

  // 끝난 패널·재생 중 패널 양쪽에서 온다. 플레이어가 없으면 만든다. /autoplay와 같은 길.
  async handleAutoplayButton(interaction) {
    const { guild, member, channel } = interaction;

    // 재생 조작이므로 DJ 계층. 봇이 유휴면 재적 검사가 통과해 버리므로 소환 가능 여부를 이어 붙인다.
    const permErr = (await checkControl(member)) || checkSummon(member);
    if (permErr) return await interaction.reply({ content: permErr, flags: [1 << 6] });

    const { client } = interaction;
    const player = client.players.get(guild.id) ?? ensurePlayer(client, { guild, textChannel: channel, voiceChannel: member.voice?.channel ?? null });
    return await this.handleAutoplay(interaction, player, member.id);
  },

  // 권한은 handleAutoplayButton이 이미 봤다.
  async handleAutoplay(interaction, player, requesterId) {
    if (player.autoplay) {
      player.setAutoplay(false);

      // 끄기는 이미 실행됐다. 30초 동안 장르를 다시 고를 기회만 남긴다. 고르면 변경, 두면 종료.
      expireReply(interaction, OFF_MENU_MS);
      await interaction.reply(buildAutoplayOffMenu(requesterId, player.sessionId));

      if (interaction.client.musicEmbedManager) {
        await interaction.client.musicEmbedManager.updateNowPlayingEmbed(player);
      }
      return;
    }

    // 고르는 동안 떠 있어야 한다. 수명 표는 이 버튼의 분기를 가르지 못하므로 여기서 선언한다
    keepReply(interaction);
    await interaction.reply(buildGenreMenu(requesterId, player.sessionId));
  },

  handleHelpRefresh(interaction) {
    return this.refreshMessage(interaction, (client) => helpCommand.buildHelpEmbed(client), { failed: "명령어 도움말 새로고침 실패:", notice: "❌ 도움말을 새로고침하는 중 오류가 발생했습니다!" });
  },

  async handleSystemRefresh(interaction) {
    // /system과 동일하게 봇 운영자 전용
    if (interaction.user.id !== config.dashboard.ownerId) {
      return await interaction.reply({ content: "❌ 봇 운영자만 사용할 수 있습니다!", flags: [1 << 6] });
    }
    return this.refreshMessage(interaction, (client) => systemCommand.buildSystemEmbed(client), { failed: "시스템 정보 새로고침 실패:", notice: "❌ 시스템 정보를 새로고침하는 중 오류가 발생했습니다!" });
  },

  // 새로고침 버튼: 버튼이 달린 메시지를 새 내용으로 고친다
  async refreshMessage(interaction, build, { failed, notice }) {
    try {
      await interaction.deferUpdate();
      const { embed, row } = await build(interaction.client);
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (error) {
      log.error(failed, error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: notice, flags: [1 << 6] });
        } else {
          await interaction.followUp({ content: notice, flags: [1 << 6] });
        }
      } catch (err) {
        log.error("오류 안내 전송 실패:", err);
      }
    }
  },

  async handleSearchInteraction(interaction, client) {
    const member = interaction.member;
    const guild = interaction.guild;

    // 곡 추가 경로. 봇 동작 중에는 재적 규칙만(모더레이터 면제), 유휴 시에는 소환 대상이 필요하므로 본인 재적 필수
    const botVoiceChannel = guild.members.me?.voice?.channel;
    if (botVoiceChannel) {
      const permErr = checkAdd(member);
      if (permErr) {
        return await interaction.reply({
          content: permErr,
          flags: [1 << 6],
        });
      }
    } else if (!member.voice.channel) {
      return await interaction.reply({
        content: S.ERR_VOICE_REQUIRED,
        flags: [1 << 6],
      });
    }

    // 메시지 ID로 키잉. 같은 사용자의 재검색/다른 서버의 검색과 섞이지 않음
    const userSearchData = client.searchResults?.get(interaction.message.id);
    if (!userSearchData) {
      return await interaction.reply({
        content: "❌ 검색 결과를 찾을 수 없거나 만료되었습니다! 다시 검색해 주세요.",
        flags: [1 << 6],
      });
    }

    if (userSearchData.userId !== interaction.user.id) {
      return await interaction.reply({
        content: "❌ 검색을 요청한 사용자만 선택할 수 있습니다!",
        flags: [1 << 6],
      });
    }

    if (interaction.customId === "search_cancel") {
      client.searchResults.delete(interaction.message.id);

      const embed = new EmbedBuilder().setTitle("❌ 검색 취소됨").setDescription("검색이 취소되었습니다.").setColor("#FF0000").setTimestamp();

      return await interaction.update({ embeds: [embed], components: [] });
    }

    const selectedIndex = parseInt(interaction.customId.replace("search_select_", ""));
    const selectedTrack = userSearchData.results[selectedIndex];

    if (!selectedTrack) {
      return await interaction.reply({
        content: "❌ 잘못된 선택입니다!",
        flags: [1 << 6],
      });
    }

    await interaction.deferUpdate();

    const processingEmbed = new EmbedBuilder().setTitle("🔄 처리 중...").setDescription(`**${selectedTrack.title}** 추가 중...`).setColor("#FFAA00").setTimestamp();

    await interaction.editReply({ embeds: [processingEmbed], components: [] });

    // 안내는 채널로, 자리표시자는 이 상호작용의 "처리 중" 응답.
    // 검색 메시지는 일반 임베드라 CV2 현재 재생 메시지로 수정할 수 없다.
    const responder = channelResponder(interaction.channel, () => interaction.deleteReply().catch(() => {}));

    try {
      const result = await requestPlayback(client, {
        guild,
        requester: member,
        tracks: [selectedTrack],
        textChannel: interaction.channel,
        voiceChannel: member.voice.channel ?? null,
        responder,
        source: "/search",
      });

      client.searchResults.delete(interaction.message.id);

      if (!result.success) {
        const errorEmbed = new EmbedBuilder().setTitle("❌ 오류").setDescription(result.message).setColor("#FF0000").setTimestamp();

        return await interaction.editReply({ embeds: [errorEmbed], components: [] });
      }

      // 검색 결과 메시지 제거. 현재 재생/대기열 정보는 별도로 전송됨
      await responder.dismissPlaceholder();
    } catch (error) {
      const errorEmbed = new EmbedBuilder().setTitle("❌ 오류").setDescription(S.ERR_PROCESSING).setColor("#FF0000").setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed], components: [] });
    }
  },
};
export default exported;
export { exported as "module.exports" };
