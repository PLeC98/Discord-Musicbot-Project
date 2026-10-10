// 봇 상태 탭의 연결: 바깥 서비스마다 봇이 실제로 부른 결과(infra/link-status)와 설정으로 매긴다(상태를 보려고 따로 부르지 않는다).
// 디스코드는 게이트웨이 연결, POToken 은 서버 프로세스로 본다(봇 안의 일이라 부른 결과가 없다)

import type { Client } from "discord.js";
import config from "../../config/index.ts";
import { genres } from "../../config/genres.ts";
import { ai } from "../../config/ai.ts";
import { aiSwitchedOff } from "../../config/schema/ai.ts";
import * as procRegistry from "../../infra/process-registry.ts";
import { linkStatus, type Service } from "../../infra/link-status.ts";
import { LB_TIMEOUT_MS } from "../../autoplay/sources/lbradio.ts";
import { anonTokenExpiresAt } from "../../sources/spotify.ts";
import type { LinkRow } from "../contract/admin.ts";
import { gateway } from "./gateway.ts";

/** 지난 1시간 부르지 않았으면 쉰다 */
const IDLE_MS = 60 * 60_000;
/** 이보다 오래 걸리면 느림(ms). 원래 느린 것은 따로 */
const SLOW_MS = 3000;
const SLOW_FOR: Partial<Record<Service, number>> = { listenbrainz: 15_000, ai: 15_000 };
/** 최근 결과 중 이만큼 실패했으면 마지막이 성공이어도 느림 */
const SHAKY_FAILS = 3;

type Group = LinkRow["group"];
const ROWS: Array<{ id: Service; group: Group; name: string }> = [
  { id: "spotify", group: "play", name: "Spotify" },
  { id: "soundcloud", group: "play", name: "SoundCloud" },
  { id: "sponsorblock", group: "play", name: "SponsorBlock" },
  { id: "ai", group: "autoplay", name: "AI 보조" },
  { id: "lastfm", group: "autoplay", name: "Last.fm" },
  { id: "listenbrainz", group: "autoplay", name: "ListenBrainz" },
  { id: "animethemes", group: "autoplay", name: "AnimeThemes" },
  { id: "anisongdb", group: "autoplay", name: "AnisongDB" },
  { id: "vocadb", group: "autoplay", name: "VocaDB" },
  { id: "utaitedb", group: "autoplay", name: "UtaiteDB" },
  { id: "touhoudb", group: "autoplay", name: "TouhouDB" },
];

/** 자동재생 출처 서비스가 쓰는 장르 출처 종류 */
const SOURCE_TYPE: Partial<Record<Service, string>> = { lastfm: "lastfm", listenbrainz: "lbradio", animethemes: "animethemes", anisongdb: "anisongdb", vocadb: "vocadb", utaitedb: "utaitedb", touhoudb: "touhoudb" };

/** 장르들이 쓰는 출처 종류. 장르 설정을 못 읽으면 null */
function usedSourceTypes() {
  try {
    return new Set(Object.values(genres().genres).flatMap((genre) => genre.sources.map((source) => source.type)));
  } catch {
    return null;
  }
}

/** 쓰지 않는 까닭(설정). 쓰면 null */
function offReason(id: Service, used: Set<string> | null): string | null {
  if (id === "sponsorblock" && !config.sponsorblock.enabled) return "꺼 둠";
  if (id === "ai") return aiSwitchedOff(ai()) ? "꺼 둠" : null;
  if (id === "lastfm" && !config.sources.lastfmKey) return "키 없음";
  if (id === "listenbrainz" && !config.sources.listenbrainzToken) return "토큰 없음";
  const type = SOURCE_TYPE[id];
  if (!type) return null;
  if (!used) return "장르 설정을 읽지 못함";
  return used.has(type) ? null : "이 출처를 쓰는 장르가 없음";
}

/** 줄에 늘 붙는 설명: AI 는 모델, Spotify 는 익명 토큰이 남은 시간 */
function noteOf(id: Service): string | null {
  if (id === "ai") return String(ai().model ?? "").trim() || null;
  const expiresAt = id === "spotify" ? anonTokenExpiresAt() : null;
  return expiresAt && expiresAt > Date.now() ? `익명 토큰 ${Math.round((expiresAt - Date.now()) / 60_000)}분 남음` : null;
}

/** 이름에 올리면 보이는 설명(그 서비스를 다루는 방식) */
const HINT: Partial<Record<Service, string>> = { listenbrainz: `LB Radio · ${LB_TIMEOUT_MS / 1000}초 넘으면 실패` };

/** 부른 결과로 매긴다: 쉼 · 실패(마지막이 실패) · 느림(오래 걸림 · 최근 실패가 잦음) · 정상 */
function judged(id: Service): Pick<LinkRow, "state" | "latencyMs" | "lastOkAt" | "error" | "note"> {
  const status = linkStatus(id);
  const last = status?.recent.at(-1);
  const lastOkAt = status?.lastOkAt ?? null;
  if (!status || !last || Date.now() - last.at > IDLE_MS) return { state: "idle", latencyMs: null, lastOkAt, error: null, note: noteOf(id) };
  if (!last.ok) return { state: "fail", latencyMs: null, lastOkAt, error: last.error, note: noteOf(id) };
  const fails = status.recent.filter((one) => !one.ok).length;
  const slow = last.ms > (SLOW_FOR[id] ?? SLOW_MS) || fails >= SHAKY_FAILS;
  return { state: slow ? "slow" : "ok", latencyMs: last.ms, lastOkAt, error: null, note: fails ? `최근 ${status.recent.length}번 중 ${fails}번 실패` : noteOf(id) };
}

/** 디스코드: 게이트웨이에 붙어 있으면 정상(지연은 하트비트), 다시 붙는 중이면 실패 */
function discordRow(client: Client): LinkRow {
  const { reconnects, retryAttempt } = gateway();
  const note = reconnects ? `연결 재수립 ${reconnects}회` : null;
  const base = { id: "discord", group: "play" as const, name: "디스코드 API" };
  if (retryAttempt) return { ...base, state: "fail", latencyMs: null, lastOkAt: null, error: `다시 붙는 중(${retryAttempt}번째)`, note };
  const ready = client.isReady();
  return { ...base, state: ready ? "ok" : "idle", latencyMs: ready && client.ws.ping >= 0 ? client.ws.ping : null, lastOkAt: ready ? Date.now() : null, error: null, note };
}

/** POToken: 서버를 쓰기로 했으면 그 프로세스가 떠 있는지 */
function potokenRow(): LinkRow {
  const base = { id: "potoken", group: "youtube" as const, name: "POToken", latencyMs: null, lastOkAt: null, error: null };
  if (!config.bgutil.enabled) return { ...base, state: "off", note: "꺼 둠" };
  const running = procRegistry.list().some((p) => p.job === "pot-server");
  return { ...base, state: running ? "ok" : "fail", note: running ? null : "서버가 떠 있지 않음" };
}

function linkRows(client: Client): LinkRow[] {
  const used = usedSourceTypes();
  const rows = ROWS.map(({ id, group, name }): LinkRow => {
    const off = offReason(id, used);
    if (off) return { id, group, name, state: "off", latencyMs: null, lastOkAt: linkStatus(id)?.lastOkAt ?? null, error: null, note: off, hint: HINT[id] ?? null };
    return { id, group, name, ...judged(id), hint: HINT[id] ?? null };
  });
  return [discordRow(client), ...rows.filter((row) => row.group === "play"), potokenRow(), ...rows.filter((row) => row.group !== "play")];
}

export { linkRows };
