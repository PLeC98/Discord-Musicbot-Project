// 봇 운영자(OWNER_ID) 전용 라우터. 모든 엔드포인트가 requireOwner를 지난다.
// 경로가 /api/admin인 것은 대시보드 운영자 패널의 주소일 뿐, 디스코드 서버 쪽 권한과는 무관하다.

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
const adminRouter = express.Router();
import { requireOwner } from "../middleware/require-owner.ts";
import { signedIn } from "../middleware/require-auth.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import { sendProblem } from "../problem.ts";
import logManager from "../../infra/log/sink.ts";
import { getViewAs } from "../view-as.ts";
import { isTier, type ViewAsReply } from "../contract/identity.ts";
import { guildIconUrl } from "../images.ts";
import { ANNOUNCE_MAX, ANNOUNCE_STYLE, announceBody, isAnnounceKind, type AdminGuilds, type AiFields, type AiSaved, type AiState, type BroadcastReply, type CandidatesReply, type ConfigFile, type ConfigSaved, type CookieState, type KeysReply, type LeaveReply, type LinesReply, type PromptReply, type RedeployReply, type RestartReply, type SourceTypes, type Suggestions, type TokensReply } from "../contract/admin.ts";
import * as playerEvents from "../../player/events.ts";
import * as genreConfig from "../../config/genres.ts";
import * as statusConfig from "../../config/status.ts";
import * as aiConfig from "../../config/ai.ts";
import { promptProblems } from "../../config/schema/ai-prompt.ts";
import { aiSwitchedOff } from "../../config/schema/ai.ts";
import * as cookieJar from "../../store/cookie-jar.ts";
import * as documents from "../../config/documents.ts";
import { EmbedBuilder, type Guild, type GuildBasedChannel } from "discord.js";
import * as GuildSettingsManager from "../../store/guild-settings.ts";
import * as YouTube from "../../sources/youtube/index.ts";
import * as autoplaySources from "../../autoplay/sources/index.ts";
import * as assist from "../../autoplay/assist/index.ts";
import * as tokens from "../../autoplay/assist/tokens.ts";
import * as models from "../../config/ai-models.ts";
import * as prices from "../../config/ai-prices.ts";
import { adminStatus } from "../status/index.ts";
import { ranBy } from "../ran-by.ts";
import * as aiKeys from "../../store/ai-keys.ts";
import * as googleAuth from "../../autoplay/assist/google-auth.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";

// 봇 · Node · 시스템 상태(봇 상태 탭)
adminRouter.get("/status", requireOwner, async (req, res) => {
  res.json(await adminStatus(req.app.locals.bot, signedIn(req).id, req.app.locals.stream, Boolean(req.app.locals.restart)));
});

// 봇 다시 시작. 세션을 저장하고 나가면 실행기가 다시 실행한다(app/launcher). 실행기 없이 켰으면 다시 실행해 줄 쪽이 없어 거절한다.
// 답을 보낸 뒤에 내린다. 최근 로그인은 보지 않는다(비밀이 새는 일이 아니고, 운영자 세션으로 이미 더 큰 일을 할 수 있다. 실수는 확인 창이 막는다)
adminRouter.post("/restart", requireOwner, (req, res) => {
  const restart = req.app.locals.restart;
  if (!restart) return sendProblem(res, "restart-unavailable");
  log.warn({ sub: "admin" }, `대시보드에서 봇 다시 시작. 실행 ${ranBy(req)}`);
  res.on("finish", () => restart(ranBy(req)));
  res.status(202).json({ restarting: true } satisfies RestartReply);
});

// 공지를 보낼 채널: 전용 채널 → 시스템 채널 → 보낼 수 있는 첫 텍스트 채널
async function announceChannel(guild: Guild) {
  const me = guild.members.me;
  const writable = (c: GuildBasedChannel | null | undefined) => (c && c.isTextBased() && !c.isThread() && me && c.permissionsFor(me)?.has("SendMessages") ? c : null);

  const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
  const preferred = writable(botChannelId ? guild.channels.cache.get(botChannelId) : null) ?? writable(guild.systemChannel);
  if (preferred) return preferred;
  return [...guild.channels.cache.values()]
    .map(writable)
    .filter((c) => c !== null)
    .sort((a, b) => a.position - b.position)[0];
}

adminRouter.post("/broadcast", requireOwner, async (req, res) => {
  const { message, type = "maintenance" } = req.body ?? {};

  // 문자열인지 먼저 본다(객체면 trim 이 던진다)
  if (typeof message !== "string" || !announceBody(message)) return sendProblem(res, "announce-empty");
  const body = announceBody(message);
  if (body.length > ANNOUNCE_MAX) return sendProblem(res, "announce-too-long", { max: ANNOUNCE_MAX, length: body.length });
  if (!isAnnounceKind(type)) return sendProblem(res, "bad-announce-type");

  const { client } = req.app.locals.bot;
  if (!client.isReady()) return sendProblem(res, "bot-not-ready");

  const cfg = ANNOUNCE_STYLE[type];

  const embed = new EmbedBuilder().setTitle(`${cfg.emoji} ${cfg.title}`).setDescription(body).setColor(cfg.color).setTimestamp().setFooter({ text: "봇 운영자" });

  // 서버마다 따로 보낸다. 한 서버가 늦어도 다른 서버는 기다리지 않는다
  const results = await Promise.allSettled(
    [...client.guilds.cache.values()].map(async (guild) => {
      const ch = await announceChannel(guild);
      if (!ch) throw new Error("보낼 채널 없음");
      await ch.send({ embeds: [embed] });
    }),
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - sent;

  // 한 곳도 못 보낸 것을 성공으로 돌려주면 운영자가 보냈다고 믿는다. 일부 실패도 구분해 알린다.
  const total = client.guilds.cache.size;
  if (sent === 0) return sendProblem(res, total === 0 ? "announce-no-guilds" : "announce-failed", {}, { sentCount: sent, failedCount: failed, totalCount: total });
  return res.json({ success: true, sent, failed, total, partial: failed > 0 } satisfies BroadcastReply);
});

// 봇이 든 서버 전부
adminRouter.get("/guilds", requireOwner, (req, res) => {
  const { client, players } = req.app.locals.bot;
  if (!client.isReady()) return sendProblem(res, "bot-not-ready");

  const guilds = [...client.guilds.cache.values()].map((g) => ({
    id: g.id,
    name: g.name,
    icon: guildIconUrl(g.id, g.icon),
    memberCount: g.memberCount,
    hasPlayer: players.has(g.id),
  }));

  res.json({ guilds } satisfies AdminGuilds);
});

// 서버에서 나가기(운영자가 대시보드에서)
// 재생 중이면 플레이어를 먼저 정리해 음성 연결/타이머가 남지 않게 한다.
// guild.leave() 이후에는 서버 이벤트가 오지 않을 수 있어 사후 정리에 기댈 수 없음.
adminRouter.post("/guilds/:guildId/leave", requireOwner, async (req, res) => {
  const { client, players } = req.app.locals.bot;
  if (!client.isReady()) return sendProblem(res, "bot-not-ready");

  const guild = client.guilds.cache.get(req.params.guildId);
  if (!guild) return sendProblem(res, "guild-not-found");

  const name = guild.name;
  try {
    const player = players.get(guild.id);
    if (player) await player.dispose({ reason: "운영자 패널에서 서버 나가기", session: "remove", panel: "disconnected", end: "operator-leave" });
    await guild.leave();

    // 그 서버를 보던 화면에 알린다. 다시 읽으면 봇이 없어 404 다
    playerEvents.touched(guild.id);

    log.info({ sub: "admin" }, `대시보드 운영자 패널에서 서버 나가기: ${name} (${guild.id})`);
    res.json({ success: true, name } satisfies LeaveReply);
  } catch (error) {
    log.error({ sub: "admin" }, "서버 나가기 실패:", error);
    sendProblem(res, "leave-guild-failed", {}, { detail: messageOf(error) });
  }
});

// 슬래시 명령을 디스코드에 다시 등록(운영자가 대시보드에서)
// deployCommands는 게이트웨이/음성과 무관한 REST PUT이라 봇 실행 중에도 안전하며 샤드에 종속되지 않는다.
// 조립(app/main)이 app.locals 로 넘긴다. 대시보드가 app 층을 부르지 않는다
adminRouter.post("/redeploy-commands", requireOwner, async (req, res) => {
  const r = await req.app.locals.deployCommands({ force: true }); // 대시보드 버튼 = 명시적 재배포 의도. 지문 무시
  if (r.ok) {
    // 개수는 디스코드가 등록을 받고 돌려준 것이다
    log.info({ sub: "admin" }, `대시보드 운영자 패널에서 슬래시 명령어 ${r.count}개를 ${r.scope === "guild" ? `서버 ${r.guildId}에` : "전역으로"} 다시 등록했습니다.`);
    return res.json({ success: true, count: r.count, scope: r.scope, guildId: r.guildId, names: r.names } satisfies RedeployReply);
  }
  log.error({ sub: "admin" }, `대시보드 운영자 패널에서 슬래시 명령어 재등록 실패: ${messageOf(r.error)}`);
  return sendProblem(res, "deploy-failed", {}, { detail: messageOf(r.error), discordCode: codeOf(r.error) ?? null });
});

// ── 설정 문서(장르 · 상태 문구 · AI 설정, settings.db) ──────────────────────
//
// 사람이 손으로 고치는 파일이 아니라 대시보드가 고치는 문서다(config/documents). 저장 번호로 두 탭이 서로 덮지 않게 한다.

// 검사기가 있는 것만 고칠 수 있다. 새 설정을 열면서 검사를 빠뜨리는 일이 없게 한 벌로 묶는다
const VALIDATORS: Record<string, (data: unknown) => string[]> = { genres: genreConfig.validateGenres, status: statusConfig.validateStatus, ai: aiConfig.validateAi };
const CONFIG_NAMES = Object.keys(VALIDATORS);

// 자동재생 소스 편집기가 그릴 표. 어떤 종류가 있고, 무슨 필드를 받고, 지금 쓸 수 있는가.
// 검증·실행과 같은 표에서 나온다(src/autoplay/sources). 화면이 목록을 따로 들면 소스를 더할 때
// 한쪽만 고치게 된다.
adminRouter.get("/source-types", requireOwner, async (req, res) => {
  // AnimeThemes 연도 범위를 저쪽에 물어 채우므로 비동기다(하루에 한 번만 묻고 캐시한다)
  res.json({ types: await autoplaySources.catalog() } satisfies SourceTypes);
});

// 소스 편집기의 자동완성(VocaDB 계열의 태그 · 가수). 브라우저가 저쪽에 바로 묻지 않고 여기를 거친다.
// 저쪽 CORS 를 모르고, 바깥으로 나가는 요청은 봇 User-Agent 로 나가야 한다
const SUGGEST_TERM_MAX = 100;
adminRouter.get("/source-suggest", requireOwner, async (req, res) => {
  const type = String(req.query.type || "");
  const what = String(req.query.field || "");
  const term = String(req.query.q || "").trim();
  if (!autoplaySources.isSite(type)) return sendProblem(res, "bad-suggest-type");
  if (what !== "tags" && what !== "artists") return sendProblem(res, "bad-suggest-field");
  if (!term || term.length > SUGGEST_TERM_MAX) return sendProblem(res, "bad-suggest-term", { max: SUGGEST_TERM_MAX });
  try {
    res.json({ items: await autoplaySources.suggest(type, what, term) } satisfies Suggestions);
  } catch (error) {
    log.debug(`자동완성 실패 (${type} ${what}): ${messageOf(error)}`);
    sendProblem(res, "suggest-failed", {}, { detail: messageOf(error) });
  }
});

// AI 보조. 키는 비밀 표(store/ai-keys)에 있고 값을 내려보내지 않는다. 상태만 알려 준다.
// 브라우저로 내려보내는 순간 XSS 하나로 새어 나갈 수 있고, 화면에 필요한 것은 상태뿐이다.
// 기본 프롬프트도 같이 준다. 화면이 베껴 두면 한쪽만 고치게 된다.
adminRouter.get("/ai/state", requireOwner, (req, res) => {
  // 키 값은 절대 안 내려간다. 프로바이더마다 상태만 알린다(주소는 저장된 설정으로 계산한다)
  res.json({
    ...keysReply(aiConfig.ai()),
    // 주소·키 필요 여부는 서버가 안다. 화면이 베껴 두면 한쪽만 고치게 된다
    providers: Object.entries(assist.PROVIDER_SPECS).map(([value, spec]) => ({ value, ...spec })),
    pingText: assist.PING_TEXT,
    defaultSections: assist.DEFAULT_SECTIONS,
    defaultLine: assist.DEFAULT_LINE,
    // 비운 입력란이 쓰는 값. 화면이 흐리게 보여 준다(베껴 두지 않는다)
    settingDefaults: assist.DEFAULTS,
  } satisfies AiState);
});

// 키를 고쳐 쓴다. 쓰기 전용이다. 적어 보낸 필드만 바꾸고, 돌려주는 것은 값이 아니라 유무다.
// 로그에도 이름만 남긴다.
/**
 * 그 모델이 받는 필드. 프로필(config/ai-models)이 정한다.
 * 화면은 여기서 받은 위젯·그룹 그대로 그린다.
 */
adminRouter.get("/ai/fields", requireOwner, (req, res) => {
  const registry = assist.PROVIDER_SPECS[String(req.query.provider || "")]?.registry;
  if (!registry) return res.json({ known: false, fields: [], models: [] } satisfies AiFields);

  const model = String(req.query.model || "");
  res.json({
    known: !!models.profileOf(registry, model),
    fields: model ? models.fieldsOf(registry, model) : [],
    groups: model ? models.groupsOf(registry, model) : [],
    // 프로필이 아는 모델들. 목록에 라벨을 입힐 때 쓴다
    models: models.modelsOf(registry),
  } satisfies AiFields);
});

// 앤트로픽에 물은 입력란마다의 본문 토큰. 하나라도 못 받으면 null(tik 로 어림한다)
async function countByClaude(texts: string[], provider: string, model: string) {
  const apiKey = assist.storedKey({ provider });
  const wrap = tokens.FRAMING.anthropic.perRequest;
  const ask = (one: string) =>
    tokens.countByAnthropic([{ role: "user", content: one }], { model, apiKey }).then(
      (got) => (got === null ? null : got - wrap),
      () => null,
    );
  const each = await Promise.all(texts.map((one) => (one ? ask(one) : 0)));
  return each.every((one): one is number => one !== null) ? each : null;
}

// 입력란마다의 본문 토큰. 클로드는 저쪽에 묻고, 못 받으면 tik 로 어림한다
async function countBodies(texts: string[], provider: string, model: string) {
  const by = tokens.tokenizerFor(assist.PROVIDER_SPECS[provider]?.registry, model);
  const exact = by === "claude" ? await countByClaude(texts, provider, model) : null;
  if (exact) return { each: exact, by: "claude", exact: true };
  const counted = await tokens.countAll(texts, by);
  return { each: counted.map((one) => one.tokens), by: counted[0]?.by ?? by, exact: counted[0]?.exact ?? true };
}

/**
 * 프롬프트 입력란에 적는 동안 세어 보는 곳. 본문만 센다(감싸는 몫은 미리보기에서 본다).
 * 클로드는 공개 토크나이저가 없어 저쪽에 물어본다. 무료이고 그쪽이 정확하다.
 * 세기가 상한에 걸리면(공백 없는 아주 긴 글) 503 으로 답한다
 */
adminRouter.post("/ai/tokens", requireOwner, async (req, res) => {
  const texts: unknown[] = Array.isArray(req.body?.texts) ? req.body.texts : [];
  if (texts.length > 50) return sendProblem(res, "too-many-items", { max: 50 });
  const cut = texts.map((one) => String(one ?? "").slice(0, 200000));

  try {
    const { each, by, exact } = await countBodies(cut, String(req.body?.provider || ""), String(req.body?.model || ""));
    res.json({ each, total: each.reduce((sum, one) => sum + one, 0), by, exact } satisfies TokensReply);
  } catch (error) {
    sendProblem(res, "token-count-failed", {}, { detail: messageOf(error) });
  }
});

/** 값표 갱신. 바뀌었으면 true. 못 불러와도 모델 프로필 갱신은 그대로 둔다(가진 값표로 계속 센다) */
async function refreshPrices() {
  try {
    return (await prices.refresh()).changed;
  } catch (error) {
    log.warn({ sub: "admin" }, `AI 값표를 불러오지 못했습니다(models.dev): ${messageOf(error)}. 가진 값표로 비용을 셉니다`);
    return false;
  }
}

/** 모델 프로필 · 값표 갱신. 해시가 같으면 불러오지 않는다. pnpm run update:models 와 같은 길이다. 답의 수는 모델 프로필의 것 */
adminRouter.post("/ai/models/refresh", requireOwner, async (req, res) => {
  try {
    const registries = [...new Set(Object.values(assist.PROVIDER_SPECS).flatMap((one) => (one.registry ? [one.registry] : [])))];
    const got = await models.refresh({ registries, force: !!req.body?.force });
    res.json({ ...got, changed: got.changed || (await refreshPrices()) });
  } catch (error) {
    sendProblem(res, "model-refresh-failed", {}, { detail: messageOf(error) });
  }
});

/**
 * 판정 테스트 1. 유튜브 주소로 후보를 읽는다. 아무것도 보내지 않는다.
 */
adminRouter.post("/ai/judge/lookup", requireOwner, async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  if (!urls.length) return sendProblem(res, "urls-empty");
  if (urls.length > 20) return sendProblem(res, "too-many-items", { max: 20 });

  res.json({ candidates: await assist.candidatesFromUrls(urls) } satisfies CandidatesReply);
});

/** 그 후보들이 프롬프트에 어떻게 적히는지. 목록 형식·장르를 고치는 대로 다시 그린다. */
adminRouter.post("/ai/judge/lines", requireOwner, (req, res) => {
  const cands = (Array.isArray(req.body?.candidates) ? req.body.candidates : []).filter((one: { error?: unknown; title?: unknown } | null) => one && !one.error && one.title).slice(0, 20);
  res.json({ lines: assist.renderList({ list: req.body?.list }, cands, String(req.body?.genre || "rock")) } satisfies LinesReply);
});

/** 판정 테스트 2. 그 후보들을 실제로 보내 곡별 판정을 받는다. */
adminRouter.post("/ai/judge/run", requireOwner, async (req, res) => {
  const cands = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  res.json(await assist.judgeTest(req.body?.data, cands, String(req.body?.genre || "rock")));
});

// 키를 입력하고 삭제한다. 쓰기 전용이고 로그인한 지 10분 안이어야 한다. 적어 보낸 프로바이더만 바꾸고(빈 글이면 삭제한다), 돌려주는 것은 상태다.
// 키는 화면이 지금 적어 둔 설정(data: 주소 · 리전)이 가리키는 곳에 묶는다. 그 설정을 저장해야 쓰인다
adminRouter.put("/ai/keys", requireOwner, requireRecentLogin, (req, res) => {
  const keys: unknown = req.body?.keys;
  const draft = (req.body?.data && typeof req.body.data === "object" ? req.body.data : {}) as Record<string, unknown>;
  if (!keys || typeof keys !== "object" || !Object.keys(keys).length) return sendProblem(res, "nothing-to-save");

  const problem = Object.entries(keys as Record<string, unknown>)
    .map(([provider, value]) => aiKeyProblem(provider, value, draft))
    .find(Boolean);
  if (problem) return sendProblem(res, "config-invalid", {}, { detail: problem });
  try {
    for (const [provider, value] of Object.entries(keys as Record<string, string>)) {
      if (!value.trim()) aiKeys.remove(provider);
      else aiKeys.put(provider, value.trim(), assist.keyBinding({ ...draft, provider }));
    }
  } catch (error) {
    return sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
  log.warn({ sub: "admin" }, `대시보드에서 AI 키 저장: ${Object.keys(keys).join(", ")}. 실행 ${ranBy(req)}`);
  res.json(keysReply({ ...draft }) satisfies KeysReply);
});

// 입력할 수 없는 키면 까닭. 키를 쓰는 프로바이더여야 하고, 묶을 주소가 있어야 하고, 서비스 계정은 JSON 내용이어야 한다
function aiKeyProblem(provider: string, value: unknown, draft: Record<string, unknown>) {
  const spec = assist.PROVIDER_SPECS[provider];
  if (!spec?.key) return `${provider}: 키를 쓰지 않는 프로바이더입니다`;
  if (typeof value !== "string") return `${provider}: 키는 문자열이어야 합니다`;
  if (!value.trim()) return null;
  if (!/^https?:\/\//.test(assist.keyBinding({ ...draft, provider }))) return `${spec.label}: 키를 묶을 주소가 없습니다. 주소를 먼저 입력하세요`;
  if (spec.serviceAccount) return accountProblem(spec.label, value);
  return null;
}

// 서비스 계정은 쓸 때 읽는 것(googleAuth.readAccount)과 같은 검사로 저장 전에 본다. 잘못 붙여넣은 것이 쓸 때야 드러나지 않게
function accountProblem(label: string, value: string) {
  if (!value.trim().startsWith("{")) return `${label}: 서비스 계정 JSON 내용을 붙여넣으세요(파일 경로는 받지 않습니다)`;
  try {
    googleAuth.readAccount(value);
    return null;
  } catch (error) {
    return `${label}: ${messageOf(error)}`;
  }
}

// 프로바이더마다 키 상태. settings 는 주소를 계산할 설정(저장된 것 또는 화면의 초안). 다른 프로바이더는 그 프로바이더의 기본 주소로 본다
function keysReply(settings: Record<string, unknown>): KeysReply {
  const keyState = Object.fromEntries(
    Object.entries(assist.PROVIDER_SPECS)
      .filter(([, spec]) => spec.key)
      .map(([provider]) => [provider, aiKeys.stateOf(provider, assist.keyBinding(settings.provider === provider ? settings : { provider }))]),
  );
  return { hasKey: Object.fromEntries(Object.entries(keyState).map(([provider, state]) => [provider, state === "ok"])), keyState };
}

// 프롬프트는 설정과 딴 문서다("ai-prompt", 섹션 목록). 읽기는 여기서, 저장은 AI 설정과 함께 /ai/settings 로.
adminRouter.get("/ai/prompt", requireOwner, (req, res) => {
  res.json({ sections: aiConfig.aiPrompt() } satisfies PromptReply);
});

// AI 설정과 프롬프트를 한 요청으로. 화면의 저장 버튼 하나가 둘을 고친다. 둘 다 검사한 뒤에 쓴다.
// 저장 번호는 AI 설정 문서의 것 하나로 본다(둘은 늘 함께 저장된다)
adminRouter.put("/ai/settings", requireOwner, (req, res) => {
  const data = req.body?.data;
  const sections = req.body?.sections;
  const revision: unknown = req.body?.revision;
  if (!data || typeof data !== "object" || !Array.isArray(sections) || !Number.isInteger(revision)) return sendProblem(res, "nothing-to-save");

  // 꺼 두면(enabled: false) 나머지 필드는 따지지 않고, 프롬프트는 모양이 깨지지 않을 만큼만 본다
  const on = !aiSwitchedOff(data);
  const problems = [...VALIDATORS.ai(data), ...promptProblems(sections, on)];
  if (problems.length) return sendProblem(res, "config-invalid", {}, { errors: problems.map((detail) => ({ code: "config-invalid", detail })) });

  try {
    // 한 트랜잭션. 프롬프트 쓰기가 실패하면 설정도 쓰이지 않는다
    const [next] = documents.putAll([
      { name: "ai", data, revision: revision as number },
      { name: "ai-prompt", data: sections },
    ]);
    log.warn({ sub: "admin" }, `대시보드에서 설정 저장: AI 설정 · 프롬프트. 실행 ${ranBy(req)}`);
    res.json({ data: documents.get("ai") as Record<string, unknown>, sections: aiConfig.aiPrompt(), revision: next } satisfies AiSaved);
  } catch (error) {
    if (codeOf(error) === "REVISION_CONFLICT") return sendProblem(res, "config-changed");
    log.error({ sub: "admin" }, `설정 저장 실패(AI): ${messageOf(error)}`);
    sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
});

// 유튜브 쿠키. 연령 제한 영상에만 쓰이고, 유튜브가 브라우저 쪽에서 세션을 돌리면 만료 시각과
// 무관하게 무효가 된다. 그때마다 여기서 덮어쓴다(비밀 표에 암호화, store/cookie-jar).
//
// 키와 같은 취급이다. 값은 어느 통로로도 돌아나가지 않고, 있는지 없는지만 알린다. 입력 · 삭제는 최근 로그인만
function cookieState(): CookieState {
  return { source: YouTube.statusSnapshot().cookies, hasFile: cookieJar.ready() };
}

adminRouter.get("/cookies", requireOwner, (req, res) => res.json(cookieState()));

adminRouter.put("/cookies", requireOwner, requireRecentLogin, (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string") return sendProblem(res, "nothing-to-save");

  try {
    // 내용은 절대 남기지 않는다. 로그인된 세션 그 자체다
    log.warn({ sub: "admin" }, `대시보드에서 유튜브 쿠키 ${text.trim() ? "저장" : "삭제"}. 실행 ${ranBy(req)}`);
    cookieJar.save(text);
    res.json(cookieState());
  } catch (error) {
    sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
});

// 나갈 것을 만들어만 본다. 보내지 않는다. 조립은 봇이 쓰는 코드 그대로다.
adminRouter.post("/ai/preview", requireOwner, async (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== "object") return sendProblem(res, "nothing-to-save");
  res.json(await assist.preview(data));
});

// 무료 확인. 모델 목록만 불러온다. 추론을 안 돌리니 토큰이 안 든다.
// 화면의 모델 선택 입력란도 이것으로 채운다(모델 이름을 코드에 적어 두지 않는 까닭).
adminRouter.post("/ai/models", requireOwner, async (req, res) => {
  res.json(await assist.listModels(req.body?.data || {}));
});

// 유료 확인. 짧은 물음 하나를 실제로 생성시킨다. 판정 프롬프트는 안 쓴다.
adminRouter.post("/ai/ping", requireOwner, async (req, res) => {
  res.json(await assist.ping(req.body?.data || {}));
});

adminRouter.get("/config/:name", requireOwner, (req, res) => {
  const { name } = req.params;
  if (!CONFIG_NAMES.includes(name) || !documents.isDocName(name)) return sendProblem(res, "config-not-found");
  res.json({ name, data: documents.get(name) as Record<string, unknown>, revision: documents.revisionOf(name) } satisfies ConfigFile);
});

adminRouter.put("/config/:name", requireOwner, (req, res) => {
  const { name } = req.params;
  if (!CONFIG_NAMES.includes(name)) return sendProblem(res, "config-not-found");

  const data = req.body?.data;
  const revision: unknown = req.body?.revision;
  if (!data || typeof data !== "object" || !Number.isInteger(revision) || !documents.isDocName(name)) return sendProblem(res, "nothing-to-save");

  // 저장 전에 본다. 깨진 값을 남기느니 거절한다. 봇이 그 설정으로 돌기 때문이다.
  const problems = VALIDATORS[name](data);
  if (problems.length) return sendProblem(res, "config-invalid", {}, { errors: problems.map((detail) => ({ code: "config-invalid", detail })) });

  try {
    const next = documents.put(name, data, revision as number);
    log.warn({ sub: "admin" }, `대시보드에서 설정 저장: ${name}. 실행 ${ranBy(req)}`);
    res.json({ success: true, data: documents.get(name) as Record<string, unknown>, revision: next } satisfies ConfigSaved);
  } catch (error) {
    if (codeOf(error) === "REVISION_CONFLICT") return sendProblem(res, "config-changed");
    log.error({ sub: "admin" }, `설정 저장 실패(${name}): ${messageOf(error)}`);
    sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
});

// 실시간 로그(SSE). 화면이 마지막으로 받은 줄 뒤부터 보낸다. 브라우저가 스스로 다시 붙을 때는 Last-Event-ID 를,
// 화면이 닫았다 다시 열 때는 ?after= 를 싣는다
adminRouter.get("/logs/stream", requireOwner, (req, res) => {
  const after = String(req.get("Last-Event-ID") ?? req.query?.after ?? "");
  if (!logManager.addClient(res, signedIn(req).id, after)) sendProblem(res, "too-many-streams");
});

// 권한 수준 오버라이드. { tier: "moderator"|"dj"|"user"|null }. null이면 해제.
// requireOwner가 오버라이드를 무시하므로(실 운영자 기준) 낮춘 뒤에도 여기로 되돌아올 수 있다.
adminRouter.post("/view-as", requireOwner, (req, res) => {
  const { tier } = req.body || {};
  if (tier !== null && !isTier(tier)) {
    return sendProblem(res, "bad-tier");
  }

  if (tier === null) delete req.session.viewAs;
  else req.session.viewAs = tier;

  log.info({ sub: "admin" }, `권한 수준 오버라이드: ${tier || "해제"}. 실행 ${ranBy(req)}`);
  res.json({ viewAs: getViewAs(req) } satisfies ViewAsReply);
});

export { adminRouter };
