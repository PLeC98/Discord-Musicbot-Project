// 음원 파일 앞부분의 색인(webm Cues · mp4 sidx)으로 시간 → 바이트를 안다. 보는 것은 바이트뿐이다(통신 없음).
// 위치를 옮길 때 파일 처음이 아니라 목표 앞의 키프레임(클러스터 · 조각)부터 받으려고 쓴다(media/seek-start).
//   webm  EBML → Segment → Info(TimecodeScale) · Tracks(오디오 트랙 번호) · 첫 클러스터 앞의 Cues. 위치는 Segment 데이터 시작 기준(RFC 9559 §16)
//   mp4   ftyp → moov(여기까지가 머리) → sidx(version 0 · 1, 조각마다 크기 · 길이). 조각 시작은 sidx 다음 바이트 + first_offset
// 색인이 이상하면(값이 빠짐 · 시각이나 바이트가 줄어듦 · 파일 밖 · 계층형 sidx 등) 없음으로 답한다. 부르는 쪽은 그때 파일 처음부터 받는다.

type Kind = "webm" | "mp4";
/** 키프레임 하나: 곡 안의 시각(ms)과 파일 안의 바이트. raw 는 webm 클러스터의 Timestamp 와 견줄 원래 값 */
type Point = { ms: number; byte: number; raw: number };
type ContainerIndex = { kind: Kind; headerEnd: number; points: Point[]; segment: { at: number; width: number } | null };
/** 읽은 답: 색인 · 더 받아야 함(앞에서부터 need 바이트) · 없음(까닭) */
type Read = { ok: true; index: ContainerIndex } | { ok: false; need: number } | { ok: false; why: string };
type StartPoint = { byte: number; startedAtMs: number; expectStart(bytes: Buffer): boolean };

/** 받은 첫 바이트를 확인하는 데 드는 양(webm: 클러스터 ID · 크기 · Timestamp, mp4: 상자 머리) */
const FIRST_BYTES: Record<Kind, number> = { webm: 32, mp4: 8 };
/** 디코더가 앞 소리 없이 시작하면 처음 수십 ms 가 다르다(Opus). 목표보다 이만큼 넘게 앞선 키프레임에서 시작한다 */
const PREROLL_MS = 1000;
/** 색인을 이보다 길게 받으러 가지 않는다 */
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
/** 마지막 키프레임이 곡 길이보다 이만큼 앞이거나 이만큼 뒤면 시간 축을 잘못 읽은 것이다 */
const LAST_POINT_EARLY_MS = 60_000;
const LAST_POINT_LATE_MS = 1000;

const none = (why: string): Read => ({ ok: false, why });
const need = (bytes: number): Read => (bytes > MAX_HEAD_BYTES ? none(`색인이 너무 길다(${bytes}B)`) : { ok: false, need: bytes });

// ── EBML(webm) ──

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, Cues: 0x1c53bb6b, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1, Cluster: 0x1f43b675, Timestamp: 0xe7 };

/** 가변 길이 정수. keepMarker 면 길이 표시 비트를 남긴다(ID). 모든 비트가 1 이면 크기 모름(Infinity). 버퍼가 모자라면 null */
function vint(buf: Buffer, at: number, keepMarker: boolean): { value: number; width: number } | null {
  if (at >= buf.length) return null;
  const first = buf[at];
  let width = 1;
  while (width <= 8 && !(first & (0x80 >> (width - 1)))) width++;
  if (width > 8 || at + width > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> width);
  let allOnes = value === 0xff >> width;
  for (let i = 1; i < width; i++) {
    value = value * 256 + buf[at + i];
    allOnes &&= buf[at + i] === 0xff;
  }
  return { value: !keepMarker && allOnes ? Infinity : value, width };
}

type Element = { id: number; start: number; data: number; size: number; end: number; sizeWidth: number };

function elementAt(buf: Buffer, at: number): Element | null {
  const id = vint(buf, at, true);
  const size = id && vint(buf, at + id.width, false);
  if (!id || !size) return null;
  const data = at + id.width + size.width;
  return { id: id.value, start: at, data, size: size.value, end: data + size.value, sizeWidth: size.width };
}

function uintAt(buf: Buffer, at: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + buf[at + i];
  return value;
}

/** 다 받은 요소의 자식들 */
function* childrenOf(buf: Buffer, parent: Element): Generator<Element> {
  for (let at = parent.data; at < parent.end;) {
    const el = elementAt(buf, at);
    if (!el || !Number.isFinite(el.size) || el.end > parent.end) return;
    yield el;
    at = el.end;
  }
}

/** 자식 하나의 부호 없는 정수 값. 없으면 null */
function childUint(buf: Buffer, parent: Element, id: number): number | null {
  for (const el of childrenOf(buf, parent)) if (el.id === id) return uintAt(buf, el.data, el.size);
  return null;
}

/** 오디오 트랙 번호(Tracks 의 TrackType 2). 모르면 null */
function audioTrackOf(buf: Buffer, tracks: Element): number | null {
  for (const entry of childrenOf(buf, tracks)) {
    if (entry.id === ID.TrackEntry && childUint(buf, entry, ID.TrackType) === 2) return childUint(buf, entry, ID.TrackNumber);
  }
  return null;
}

/** CuePoint 하나 → 시각(원래 값)과 Segment 기준 위치. 값이 빠졌으면 null(그 항목만 버린다) */
function cueOf(buf: Buffer, point: Element, audioTrack: number | null): { time: number; position: number } | null {
  const time = childUint(buf, point, ID.CueTime);
  let position: number | null = null;
  for (const el of childrenOf(buf, point)) {
    if (el.id !== ID.CueTrackPositions) continue;
    const at = childUint(buf, el, ID.CueClusterPosition);
    const track = childUint(buf, el, ID.CueTrack);
    // 오디오 트랙의 것, 없으면 첫 것
    if (at !== null && (position === null || (audioTrack !== null && track === audioTrack))) position = at;
  }
  return time === null || position === null ? null : { time, position };
}

type WebmParts = { segment: Element; scale: number; audioTrack: number | null; cues: Element | null; firstCluster: number };

/** Segment 의 자식을 첫 클러스터까지 훑는다. 앞부분이 모자라면 더 받아야 할 양 */
function webmParts(buf: Buffer): WebmParts | Read {
  const ebml = elementAt(buf, 0);
  if (!ebml || ebml.id !== ID.EBML || !Number.isFinite(ebml.size)) return none("EBML 머리가 아님");
  const segment = elementAt(buf, ebml.end);
  if (!segment || segment.id !== ID.Segment) return none("Segment 가 없음");
  let scale = 1_000_000;
  let audioTrack: number | null = null;
  let cues: Element | null = null;
  for (let at = segment.data; ;) {
    const el = elementAt(buf, at);
    if (!el) return need(at + 64);
    if (el.id === ID.Cluster) return { segment, scale, audioTrack, cues, firstCluster: el.start };
    if (!Number.isFinite(el.size)) return none("첫 클러스터 앞에 크기 모를 요소");
    if (el.end > buf.length) return need(el.end + 64);
    if (el.id === ID.Info) scale = childUint(buf, el, ID.TimecodeScale) ?? scale;
    if (el.id === ID.Tracks) audioTrack = audioTrackOf(buf, el);
    if (el.id === ID.Cues) cues = el;
    at = el.end;
  }
}

function readWebm(buf: Buffer, totalBytes: number): Read {
  const parts = webmParts(buf);
  if ("ok" in parts) return parts;
  const { segment, scale, audioTrack, cues, firstCluster } = parts;
  if (!cues) return none("Cues 가 첫 클러스터 앞에 없음");
  if (!(scale > 0)) return none("TimecodeScale 이 0");
  const points: Point[] = [];
  for (const el of childrenOf(buf, cues)) {
    const cue = el.id === ID.CuePoint ? cueOf(buf, el, audioTrack) : null;
    // 같은 클러스터 자리가 겹치면 앞의 것
    if (cue && !points.some((p) => p.byte === segment.data + cue.position)) points.push({ ms: (cue.time * scale) / 1e6, byte: segment.data + cue.position, raw: cue.time });
  }
  return checked({ kind: "webm", headerEnd: firstCluster, points, segment: { at: segment.start, width: segment.sizeWidth } }, totalBytes);
}

// ── ISO BMFF(mp4) ──

type Box = { type: string; start: number; data: number; end: number };

function boxAt(buf: Buffer, at: number): Box | null {
  if (at + 8 > buf.length) return null;
  let size = buf.readUInt32BE(at);
  let header = 8;
  if (size === 1) {
    if (at + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(at + 8));
    header = 16;
  }
  if (size < header) return null;
  return { type: buf.toString("latin1", at + 4, at + 8), start: at, data: at + header, end: at + size };
}

/** sidx → 조각의 시작 바이트 · 시각. 계층형(reference_type 1) · 값이 이상하면 까닭 */
function sidxPoints(buf: Buffer, sidx: Box): Point[] | string {
  const version = buf[sidx.data];
  if (version > 1) return `sidx version ${version}`;
  const timescale = buf.readUInt32BE(sidx.data + 8);
  if (timescale === 0) return "sidx timescale 이 0";
  let at = sidx.data + 12;
  const wide = version === 1;
  let time = wide ? Number(buf.readBigUInt64BE(at)) : buf.readUInt32BE(at);
  let byte = sidx.end + (wide ? Number(buf.readBigUInt64BE(at + 8)) : buf.readUInt32BE(at + 4));
  at += wide ? 16 : 8;
  const count = buf.readUInt16BE(at + 2);
  at += 4;
  if (count === 0) return "sidx 항목이 없음";
  if (at + count * 12 > sidx.end) return "sidx 항목이 상자를 넘음";
  const points: Point[] = [];
  for (let i = 0; i < count; i++, at += 12) {
    const word = buf.readUInt32BE(at);
    if (word & 0x80000000) return "계층형 sidx";
    points.push({ ms: (time / timescale) * 1000, byte, raw: time });
    byte += word & 0x7fffffff;
    time += buf.readUInt32BE(at + 4);
    if (!Number.isSafeInteger(byte) || !Number.isSafeInteger(time)) return "sidx 값이 넘침";
  }
  points.push({ ms: (time / timescale) * 1000, byte, raw: time }); // 마지막 조각의 끝(검사에만 쓴다)
  return points;
}

function readMp4(buf: Buffer, totalBytes: number): Read {
  let moovEnd: number | null = null;
  for (let at = 0; ;) {
    const box = boxAt(buf, at);
    if (!box) return at + 16 > buf.length ? need(at + 64) : none("상자가 깨짐");
    if (at === 0 && box.type !== "ftyp") return none("ftyp 로 시작하지 않음");
    if (box.type === "moof" || box.type === "mdat") return none("sidx 가 조각 앞에 없음");
    if (box.end > buf.length) return need(box.end);
    if (box.type === "moov") moovEnd = box.end;
    if (box.type === "sidx") {
      if (moovEnd === null) return none("sidx 가 moov 앞에 있음");
      const points = sidxPoints(buf, box);
      if (typeof points === "string") return none(points);
      const end = points.pop()!;
      if (end.byte > totalBytes) return none("sidx 의 끝이 파일 밖");
      return checked({ kind: "mp4", headerEnd: moovEnd, points, segment: null }, totalBytes);
    }
    at = box.end;
  }
}

// ── 함께 ──

/** 시각 · 바이트가 늘어나기만 하고 모두 [머리 끝, 파일 끝) 안인가 */
function checked(index: ContainerIndex, totalBytes: number): Read {
  const { points, headerEnd } = index;
  if (points.length === 0) return none("색인 항목이 없음");
  for (const [i, p] of points.entries()) {
    if (p.byte < headerEnd || p.byte >= totalBytes) return none(`색인이 가리키는 자리가 파일 밖(${p.byte})`);
    if (i > 0 && (p.ms <= points[i - 1].ms || p.byte <= points[i - 1].byte)) return none("색인의 시각 · 바이트가 늘어나지 않음");
  }
  return { ok: true, index };
}

/** 파일 앞부분(head)의 색인. totalBytes 는 파일 전체 크기 */
function readIndex(head: Buffer, totalBytes: number): Read {
  if (head.length >= 4 && head.readUInt32BE(0) === ID.EBML) return readWebm(head, totalBytes);
  if (head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp") return readMp4(head, totalBytes);
  return none("webm · mp4 가 아님");
}

/** 머리로 넣을 바이트. webm 은 Segment 크기를 같은 너비의 크기 모름으로 바꾼다(중간을 건너뛰고 넣어도 디먹서가 크기를 따지지 않게) */
function headerOf(head: Buffer, index: ContainerIndex): Buffer {
  const header = Buffer.from(head.subarray(0, index.headerEnd));
  if (index.segment) {
    const at = index.segment.at + 4; // Segment ID 는 4바이트
    const { width } = index.segment;
    // 길이 표시 비트 하나와 나머지가 모두 1(EBML 의 크기 모름)
    header[at] = (0x100 >> width) | (0xff >> width);
    for (let i = 1; i < width; i++) header[at + i] = 0xff;
  }
  return header;
}

/** 받은 첫 바이트가 그 키프레임의 자리인가. webm 은 클러스터와 그 Timestamp, mp4 는 moof 상자 */
function startCheck(kind: Kind, point: Point): (bytes: Buffer) => boolean {
  if (kind === "mp4") return (bytes) => bytes.length >= 8 && bytes.toString("latin1", 4, 8) === "moof";
  return (bytes) => {
    const cluster = elementAt(bytes, 0);
    if (!cluster || cluster.id !== ID.Cluster) return false;
    const stamp = elementAt(bytes, cluster.data);
    return !!stamp && stamp.id === ID.Timestamp && stamp.end <= bytes.length && uintAt(bytes, stamp.data, stamp.size) === point.raw;
  };
}

/**
 * 목표 위치에서 받기 시작할 키프레임. 목표보다 예열(1초) 넘게 앞선 마지막 것. 없으면 까닭(부르는 쪽은 파일 처음부터).
 * 그 바이트가 첫 청크 안이면 처음부터 받는 것과 다르지 않다. 마지막 키프레임이 곡 길이와 크게 다르면 시간 축을 잘못 읽은 것이다
 */
function startPoint(index: ContainerIndex, { targetMs, durationMs, chunkBytes }: { targetMs: number; durationMs: number; chunkBytes: number }): StartPoint | { why: string } {
  const last = index.points.at(-1)!;
  if (!(durationMs > 0) || last.ms < durationMs - LAST_POINT_EARLY_MS || last.ms > durationMs + LAST_POINT_LATE_MS) return { why: `마지막 키프레임(${Math.round(last.ms)}ms)이 곡 길이(${Math.round(durationMs)}ms)와 맞지 않음` };
  const point = index.points.filter((p) => p.ms <= targetMs - PREROLL_MS).at(-1);
  if (!point) return { why: "목표 앞에 키프레임이 없음" };
  if (point.byte < chunkBytes) return { why: "키프레임이 첫 청크 안" };
  return { byte: point.byte, startedAtMs: Math.round(point.ms), expectStart: startCheck(index.kind, point) };
}

/** 머리를 받으러 갈 만한가(받기 전에). 목표 바이트를 평균으로 어림해 첫 청크 둘 안이면 처음부터 받아도 차이가 없다 */
function worthIndexing({ startMs, durationMs, totalBytes, chunkBytes }: { startMs: number; durationMs: number; totalBytes: number; chunkBytes: number }): boolean {
  if (!(startMs > 0) || !(durationMs > 0) || !(totalBytes > 0)) return false;
  return (startMs / durationMs) * totalBytes >= 2 * chunkBytes;
}

export { readIndex, headerOf, startPoint, worthIndexing, FIRST_BYTES, PREROLL_MS };
export type { ContainerIndex, Point, Read, StartPoint, Kind };
