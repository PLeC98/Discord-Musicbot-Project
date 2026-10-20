// 받아 둔 유튜브 영상 정보. 곡 정보 · 재생 주소가 추출한 것을 재생 주소 · 다운로드가 다시 쓴다(같은 영상을 짧은 사이에 다시 추출하지 않게).
// 봇 전체에 하나. 줄인 JSON 글자로 두고 꺼낼 때마다 새로 읽은 사본을 준다. 남은 곡을 다 받기 전에 주소가 만료될 것은 꺼내지 않는다(rules/stream-reuse).
// 그 곡의 다운로드가 끝나면 지운다(youtube/ytdlp-run 의 downloadAudio). 크기 합이 상한을 넘으면 만료된 것 → 가장 오래 남은 것을 밀어낸다.
// 주소는 추출한 IP 에 묶인다(열리지 않으면 재생 쪽이 새로 받는다)

import os from "node:os";
import { expireOf, reuseState } from "../../rules/stream-reuse.ts";

type Info = Record<string, unknown>;
type Entry = { text: string; expireMs: number };

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const HOUR_MS = 3_600_000;
/** 줄여도 이보다 크면 두지 않는다 */
const ENTRY_MAX = 256 * 1024;
/** 맨 위에서 뺄 것(재생 주소 · 다운로드가 읽지 않는다). 쿠키는 메모리 · 다운로드에 넘기는 파일에 남기지 않는다 */
const DROP = ["automatic_captions", "subtitles", "thumbnails", "heatmap", "description", "chapters", "tags", "categories", "cookies"];

/** 상한: 메모리 1GB 마다 2MB, 8 ~ 64MB. 프로세스에 걸린 상한(컨테이너)이 있으면 그것으로 */
function budgetFor(constrained: number, total: number): number {
  const memory = constrained > 0 && constrained < total ? constrained : total;
  return Math.min(64 * MB, Math.max(8 * MB, Math.floor(memory / GB) * 2 * MB));
}

// 넣은 차례 그대로(같은 곡을 다시 넣으면 뒤로 간다). 앞이 가장 오래 남은 것
const entries = new Map<string, Entry>();
let bytes = 0;
let budget: number | null = null;
// 밀려난 영상 id 와 그 때. 그 뒤 1시간 안에 필요해지면 놓친 것으로 센다
const evicted = new Map<string, number>();
const reusedAt: number[] = [];
const missedAt: number[] = [];

/** 테스트: 비우고 상한을 정한다(null 이면 메모리로) */
function useRecentInfo(fixedBudget: number | null = null) {
  entries.clear();
  evicted.clear();
  reusedAt.length = 0;
  missedAt.length = 0;
  bytes = 0;
  budget = fixedBudget;
}

const isObject = (value: unknown): value is Info => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// 헤더에서 쿠키를 뺀 사본
function withoutCookie(headers: unknown): unknown {
  if (!isObject(headers)) return headers;
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "cookie"));
}

/** 둘 만한 것이면 줄인 사본, 아니면 null(재생목록 · 라이브 · 예약 방송 · 주소 없음 · 만료 모름 · 조각 목록) */
function trimmed(info: Info): Info | null {
  if (info._type === "playlist" || info.is_live === true || info.live_status === "is_live" || info.live_status === "is_upcoming") return null;
  if (typeof info.url !== "string" || !expireOf(info.url)) return null;
  if (info.fragments || /dash|m3u8/.test(String(info.protocol ?? ""))) return null;
  const out: Info = { ...info };
  for (const key of DROP) delete out[key];
  out.http_headers = withoutCookie(info.http_headers);
  // 소리만 있는 포맷과 고른 포맷(스토리보드는 소리도 영상도 없다)
  const formats = Array.isArray(info.formats) ? info.formats.filter(isObject) : [];
  out.formats = formats.filter((f) => (f.acodec !== "none" && f.vcodec === "none") || f.format_id === info.format_id).map(({ cookies: _cookies, ...f }) => ({ ...f, http_headers: withoutCookie(f.http_headers) }));
  return out;
}

function drop(id: string) {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  bytes -= entry.text.length;
}

// 1시간 지난 셈 · 밀려난 기록을 버린다
function prune(now: number) {
  for (const list of [reusedAt, missedAt]) while (list.length && list[0] <= now - HOUR_MS) list.shift();
  for (const [id, at] of evicted) {
    if (at > now - HOUR_MS) break;
    evicted.delete(id);
  }
}

// 상한을 넘으면 만료된 것부터, 그다음 가장 오래 남은 것을 밀어낸다
function makeRoom(now: number) {
  budget ??= budgetFor(process.constrainedMemory(), os.totalmem());
  if (bytes <= budget) return;
  for (const [id, entry] of entries) if (entry.expireMs <= now) drop(id);
  for (const id of entries.keys()) {
    if (bytes <= budget) break;
    drop(id);
    evicted.set(id, now);
  }
}

/** yt-dlp 가 준 영상 정보를 둔다. 둘 만한 것이 아니면 그냥 넘어간다. 같은 곡이면 새 것으로 바꾼다 */
function remember(raw: unknown) {
  if (!isObject(raw) || typeof raw.id !== "string") return;
  const info = trimmed(raw);
  if (!info) return;
  const text = JSON.stringify(info);
  if (text.length > ENTRY_MAX) return;
  const now = Date.now();
  drop(raw.id);
  evicted.delete(raw.id);
  entries.set(raw.id, { text, expireMs: expireOf(String(info.url)) ?? now });
  bytes += text.length;
  makeRoom(now);
}

/** 다시 쓸 영상 정보(새로 읽은 사본). 없거나 곡을 다 받기 전에 만료될 것이면 null */
function recall(id: string): Info | null {
  const now = Date.now();
  prune(now);
  const entry = entries.get(id);
  if (!entry) {
    if (evicted.delete(id)) missedAt.push(now);
    return null;
  }
  const info = JSON.parse(entry.text) as Info;
  if (reuseState(String(info.url), (Number(info.duration) || 0) * 1000, now) !== "ok") {
    drop(id);
    return null;
  }
  reusedAt.push(now);
  return info;
}

/** 그 곡의 정보를 지운다(다운로드가 끝났다) */
function forget(id: string) {
  drop(id);
}

/** 봇 상태 탭: 지난 1시간 다시 쓴 수 · 밀려난 뒤 필요해져 놓친 수 */
function reuseLoad(): { reused: number; missed: number } {
  prune(Date.now());
  return { reused: reusedAt.length, missed: missedAt.length };
}

export { remember, recall, forget, reuseLoad, useRecentInfo, budgetFor, trimmed };
