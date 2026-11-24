// 봇 상태 탭의 연결: 바깥 서비스마다 봇이 실제로 부른 결과(infra/link-status)와 설정으로 매긴다(상태를 보려고 따로 부르지 않는다).
// 디스코드는 게이트웨이 연결, POToken은 서버 프로세스로 본다(봇 안에서 도는 것이라 부른 결과가 없다)

import type { Client } from "discord.js";
import config from "../../config/index.ts";
import { genres, genresBroken } from "../../config/genres.ts";
import { ai } from "../../config/ai.ts";
import { aiSwitchedOff } from "../../config/schema/ai.ts";
import * as procRegistry from "../../infra/process-registry.ts";
import { linkStatus, type Service } from "../../infra/link-status.ts";
import { LB_TIMEOUT_MS } from "../../autoplay/sources/lbradio.ts";
import { anonTokenExpiresAt } from "../../sources/spotify.ts";
import { potServerUrl } from "../../sources/youtube/pot-server.ts";
import type { LinkRow } from "../contract/admin.ts";
import { plain, rule, type RuleProblem } from "../../rules/rule-problem.ts";
import { gateway } from "./gateway.ts";

/** 지난 1시간 부르지 않았으면 쉰다 */
const IDLE_MS = 60 * 60_000;
/** 이보다 오래 걸리면 느림(ms). 원래 느린 것은 따로 */
const SLOW_MS = 3000;
const SLOW_FOR: Partial<Record<Service, number>> = { listenbrainz: 15_000, ai: 15_000 };
/** 최근 결과 중 이만큼 실패했으면 마지막이 성공이어도 느림 */
const SHAKY_FAILS = 3;

type Group = LinkRow["group"];
// 이름은 화면이 id로 찾는다(그 언어의 이름)
const ROWS: Array<{ id: Service; group: Group }> = [
  { id: "spotify", group: "play" },
  { id: "soundcloud", group: "play" },
  { id: "sponsorblock", group: "play" },
  { id: "youtube", group: "youtube" },
  { id: "ai", group: "autoplay" },
  { id: "lastfm", group: "autoplay" },
  { id: "listenbrainz", group: "autoplay" },
  { id: "animethemes", group: "autoplay" },
  { id: "anisongdb", group: "autoplay" },
  { id: "vocadb", group: "autoplay" },
  { id: "utaitedb", group: "autoplay" },
  { id: "touhoudb", group: "autoplay" },
];

/** 자동재생 출처 서비스가 쓰는 장르 출처 종류 */
const SOURCE_TYPE: Partial<Record<Service, string>> = { lastfm: "lastfm", listenbrainz: "lbradio", animethemes: "animethemes", anisongdb: "anisongdb", vocadb: "vocadb", utaitedb: "utaitedb", touhoudb: "touhoudb" };

/** 장르들이 쓰는 출처 종류. 장르 설정이 검사를 못 지나면 null */
function usedSourceTypes() {
  if (genresBroken()) return null;
  return new Set(Object.values(genres().genres).flatMap((genre) => genre.sources.map((source) => source.type)));
}

/** 쓰지 않는 이유(설정). 쓰면 null */
function offReason(id: Service, used: Set<string> | null): RuleProblem | null {
  if (id === "sponsorblock" && !config.sponsorblock.enabled) return rule("link-off");
  if (id === "ai") return aiSwitchedOff(ai()) ? rule("link-off") : null;
  if (id === "lastfm" && !config.sources.lastfmKey) return rule("link-no-key");
  if (id === "listenbrainz" && !config.sources.listenbrainzToken) return rule("link-no-token");
  const type = SOURCE_TYPE[id];
  if (!type) return null;
  if (!used) return rule("link-genres-broken");
  return used.has(type) ? null : rule("link-unused");
}

/** 행에 늘 붙는 설명: AI는 모델, Spotify는 익명 토큰이 남은 시간 */
function noteOf(id: Service): RuleProblem | null {
  if (id === "ai") {
    const model = String(ai().model ?? "").trim();
    return model ? plain(model) : null;
  }
  const expiresAt = id === "spotify" ? anonTokenExpiresAt() : null;
  return expiresAt && expiresAt > Date.now() ? rule("link-anon-token", { min: Math.round((expiresAt - Date.now()) / 60_000) }) : null;
}

/** 이름에 올리면 보이는 설명(그 서비스를 다루는 방식) */
const HINT: Partial<Record<Service, RuleProblem>> = { listenbrainz: rule("link-lb-hint", { sec: LB_TIMEOUT_MS / 1000 }) };

/** 부른 결과로 매긴다: 쉼, 실패(마지막이 실패), 느림(오래 걸림, 최근 실패가 잦음), 정상 */
function judged(id: Service): Pick<LinkRow, "state" | "latencyMs" | "lastOkAt" | "error" | "note"> {
  const status = linkStatus(id);
  const last = status?.recent.at(-1);
  const lastOkAt = status?.lastOkAt ?? null;
  if (!status || !last || Date.now() - last.at > IDLE_MS) return { state: "idle", latencyMs: null, lastOkAt, error: null, note: noteOf(id) };
  if (!last.ok) return { state: "fail", latencyMs: null, lastOkAt, error: last.error, note: noteOf(id) };
  const fails = status.recent.filter((one) => !one.ok).length;
  const slow = last.ms > (SLOW_FOR[id] ?? SLOW_MS) || fails >= SHAKY_FAILS;
  return { state: slow ? "slow" : "ok", latencyMs: last.ms, lastOkAt, error: null, note: fails ? rule("link-recent-fails", { total: status.recent.length, fails }) : noteOf(id) };
}

/** 디스코드: 게이트웨이에 연결돼 있으면 정상(지연은 하트비트), 재연결 중이면 실패 */
function discordRow(client: Client): LinkRow {
  const { reconnects, retryAttempt } = gateway();
  const note = reconnects ? rule("link-reconnects", { count: reconnects }) : null;
  const base = { id: "discord", group: "play" as const };
  if (retryAttempt) return { ...base, state: "fail", latencyMs: null, lastOkAt: null, error: rule("link-reconnecting", { attempt: retryAttempt }), note };
  const ready = client.isReady();
  return { ...base, state: ready ? "ok" : "idle", latencyMs: ready && client.ws.ping >= 0 ? client.ws.ping : null, lastOkAt: ready ? Date.now() : null, error: null, note };
}

/** POToken: 서버를 쓰기로 했으면 그 프로세스가 떠 있는지 */
function potokenRow(): LinkRow {
  const base = { id: "potoken", group: "youtube" as const, latencyMs: null, lastOkAt: null, error: null };
  if (!config.bgutil.enabled) return { ...base, state: "off", note: rule("link-off") };
  const running = procRegistry.list().some((p) => p.job === "pot-server");
  // 서버는 실행마다 빈 포트에 열린다. 떠 있으면 그 주소를 보인다
  const url = potServerUrl()?.replace(/^http:\/\//, "");
  return { ...base, state: running ? "ok" : "fail", note: running ? (url ? plain(url) : null) : rule("link-pot-down") };
}

function linkRows(client: Client): LinkRow[] {
  const used = usedSourceTypes();
  const rows = ROWS.map(({ id, group }): LinkRow => {
    const off = offReason(id, used);
    if (off) return { id, group, state: "off", latencyMs: null, lastOkAt: linkStatus(id)?.lastOkAt ?? null, error: null, note: off, hint: HINT[id] ?? null };
    return { id, group, ...judged(id), hint: HINT[id] ?? null };
  });
  return [discordRow(client), ...rows.filter((row) => row.group === "play"), potokenRow(), ...rows.filter((row) => row.group !== "play")];
}

export { linkRows };
