// /system: 봇 운영자에게만 봇 상태를 이미지 두 장으로 보여 준다(ui/system-card). 값과 판정은 대시보드 봇 상태 탭과 같다(dashboard/status의 statusCore, rules/status-levels).
// 이미지는 워커 스레드에서 그려 몇백 ms 걸릴 수 있다. 미뤄 둔 응답은 Components V2로 바꿀 수 없어 V2 자리표시자를 먼저 보내고 이미지를 첨부해 고친다

import { SlashCommandBuilder } from "discord.js";
import config from "../../config/index.ts";
import { COUNTS_ONLY } from "../../dashboard/contract/admin.ts";
import { statusCore, type StatusCore } from "../../dashboard/status/index.ts";
import type { BotContext } from "../../app/bot-context.ts";
import type { GuildCommand } from "../../app/command-loader.ts";
import { BOT_VERSION } from "../../infra/version.ts";
import { FRAME_MS, attentionOf, diskLevel, heapPercent, metricLevels, overallOf, statusInputOf } from "../../rules/status-levels.ts";
import { bgutilVersions } from "../../sources/bgutil/version.ts";
import { ytdlpBinary } from "../../sources/ytdlp-binary.ts";
import { colorOf } from "../../ui/colors.ts";
import { LIFETIME, expireSelf, noticeMs, noticeSelf, replaceSelf } from "../../ui/delivery.ts";
import { showFailureWith } from "../../ui/failure-notice.ts";
import { noticeFrame, post, reply } from "../../ui/frame.ts";
import { playState } from "../../ui/player-status.ts";
import type { CardData } from "../../ui/system-card/draw.ts";
import { renderSystemCards } from "../../ui/card-render/render.ts";
import { systemView, type SystemView } from "../../ui/system-card/view.ts";
import { isBotOwner } from "../../usecases/permissions.ts";
import { personLanguage, privateText } from "../../ui/language.ts";
import { textFor } from "../../ui/text/index.ts";
import type { Language } from "../../rules/languages.ts";

const MB = 1024 * 1024;
type Bot = Pick<BotContext, "client" | "players">;

/** CPU 모델 이름에서 상표 기호와 "CPU @" 뒤 클럭 표기를 뺀다 */
const cpuModelName = (model: string) =>
  model
    .replace(/\((R|TM)\)/gi, "")
    .replace(/\bCPU\b.*$/, "")
    .replace(/\s+/g, " ")
    .trim() || model;

const peak = (values: number[]) => Math.max(0, ...values);

/** 이미지에 그릴 값. 그래프 세로축은 대시보드와 같은 하한(CPU 100%, 이벤트 루프 지연 100ms, 인코딩은 응답 예산)과 최댓값 중 큰 쪽 */
function cardDataOf(core: StatusCore, { client, players }: Bot, language: Language): CardData {
  const input = statusInputOf(core);
  const level = metricLevels(input);
  const h = core.history;
  const memory = core.node.memory;
  const budget = (core.encoding.maxDepth - 1) * FRAME_MS;
  return {
    language,
    seed: colorOf("brand"),
    overall: overallOf(attentionOf(input)),
    recent: { warn: core.recent.warn, error: core.recent.error },
    cpu: { bot: core.cpu.bot, system: core.cpu.system, cores: core.system.cpus, model: cpuModelName(core.system.cpuModel), level: level.cpu },
    heap: { used: memory.heapUsed * MB, limit: memory.heapLimit * MB, rss: memory.rss * MB, percent: heapPercent(memory), level: level.heap },
    cache: { bytes: core.storage.cache.bytes, maxBytes: core.storage.cache.maxBytes },
    disk: { ...core.storage.disk, level: diskLevel(core.storage.disk) },
    uptime: { bot: core.bot.uptime, os: core.system.uptime },
    overview: {
      guilds: client.guilds.cache.size,
      playing: [...players.values()].filter((player) => playState(player) === "playing").length,
      users: client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0),
    },
    history: {
      minutes: Math.round((h.cpuBot.length * h.stepMs) / 60_000),
      cpuBot: { values: h.cpuBot, max: 100 },
      cpuSystem: { values: h.cpuSystem, max: 100 },
      loop: { values: h.loopP99, max: Math.max(100, peak(h.loopP99)), now: core.loop.p99, level: level.loop },
      encoding: { values: h.encodeRtt, max: Math.max(budget, peak(h.encodeRtt)), now: peak(core.encoding.workers.map((w) => w.rttP99)), level: level.encoding },
    },
  };
}

/** 제목 옆 프로필 이미지와 아래 버전 줄. bgutil은 POToken 서버를 켰을 때만 */
function headOf({ client }: Bot): Omit<SystemView, "images" | "updatedAt"> {
  return {
    avatar: client.user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null,
    versions: { bot: BOT_VERSION, ytdlp: ytdlpBinary.state?.version ?? null, bgutil: config.bgutil.enabled ? (bgutilVersions()?.installed ?? null) : null },
  };
}

/** 현재 값으로 그린 화면. 그리지 못하면 이미지 자리에 한 줄(원인은 ui/card-render/render가 warn으로 남긴다) */
/** language: 보는 사람의 언어(본인에게만 보이는 화면) */
async function systemScreen(bot: Bot, language: Language) {
  const core = statusCore(bot, COUNTS_ONLY);
  const base = { ...headOf(bot), updatedAt: Math.floor(Date.now() / 1000) };
  const images = await renderSystemCards(cardDataOf(core, bot, language)).catch(() => "failed" as const);
  return systemView(textFor(language), { ...base, images });
}

const exported: GuildCommand = {
  help: { section: "info", tier: "owner" },
  name: "system",
  data: (C) => new SlashCommandBuilder().setName("system").setDescription(C.system.description),

  async execute(interaction, bot) {
    // 호스트 CPU, 메모리 정보가 나간다
    if (!isBotOwner(interaction.user.id)) {
      return noticeSelf(interaction, privateText(interaction).errors.notice("must-owner"));
    }
    await interaction.reply(reply(systemView(privateText(interaction), { ...headOf(bot), updatedAt: Math.floor(Date.now() / 1000), images: "drawing" }).view));
    expireSelf(interaction, LIFETIME.screen);
    // 여기서부터 예외를 던지면 자리표시자를 오류 안내로 바꾼다(그리는 중인 화면이 남지 않게)
    showFailureWith(interaction, (notice) => replaceSelf(interaction, noticeFrame(notice), noticeMs(notice)));
    const { view, files } = await systemScreen(bot, personLanguage(interaction));
    await interaction.editReply(post(view, files));
  },
};
export default exported;
export { systemScreen, cardDataOf };
