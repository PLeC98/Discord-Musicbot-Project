// HLS 세그먼트가 RFC 8216이 허용하는 컨테이너로 시작하는지 판정한다. 복호화한 앞부분으로 AES-128 키가 맞는지 본다(media/direct-input).
//   MPEG-TS        0, 188, 376바이트가 동기 바이트 0x47(틀린 키로 우연히 맞을 확률 1/1600만)
//   Packed Audio   ID3 태그(버전 2 ~ 4, 크기 바이트의 최상위 비트 0)
//   fMP4           첫 박스 크기(8 이상, 1이면 64비트 크기 16 이상)와 ISO BMFF 최상위 박스 이름
// 코덱은 보지 않는다

type SegmentStart = "ok" | "bad" | "more";

const TS_PACKET = 188;
const TS_SYNC = 0x47;
/** 앞에서 동기 바이트를 확인할 TS 패킷 수 */
const TS_PACKETS_CHECKED = 3;
/** 세그먼트 첫머리에 올 수 있는 ISO BMFF 최상위 박스 */
const TOP_BOXES = new Set(["ftyp", "styp", "sidx", "ssix", "prft", "emsg", "moof", "mdat", "moov", "free", "skip", "uuid", "meta"]);

/** TS 판정에 필요한 바이트 수(세 번째 패킷의 동기 바이트까지). ID3는 10, fMP4는 8(64비트 크기면 16) */
const TS_NEED = (TS_PACKETS_CHECKED - 1) * TS_PACKET + 1;

/**
 * 앞부분 bytes 로 판정한다. 판정에 필요한 만큼 모이지 않았으면 "more".
 * whole: bytes 가 세그먼트 전체인지 여부(짧은 세그먼트). 있는 만큼으로 판정하고 최소 길이에 모자라면 "bad", TS 는 안에 든 모든 패킷 경계를 본다
 */
function segmentStart(bytes: Buffer, whole = false): SegmentStart {
  if (bytes.length === 0) return whole ? "bad" : "more";
  if (bytes[0] === TS_SYNC) return tsStart(bytes, whole);
  if (bytes.length < 3) return whole ? "bad" : "more";
  if (bytes.toString("latin1", 0, 3) === "ID3") return id3Start(bytes, whole);
  return boxStart(bytes, whole);
}

function tsStart(bytes: Buffer, whole: boolean): SegmentStart {
  if (!whole && bytes.length < TS_NEED) return "more";
  const packets = whole ? Math.ceil(bytes.length / TS_PACKET) : TS_PACKETS_CHECKED;
  for (let i = 0; i < packets; i++) if (bytes[i * TS_PACKET] !== TS_SYNC) return "bad";
  return "ok";
}

function id3Start(bytes: Buffer, whole: boolean): SegmentStart {
  if (bytes.length < 10) return whole ? "bad" : "more";
  const version = bytes[3];
  if (version < 2 || version > 4) return "bad";
  return bytes.subarray(6, 10).every((byte) => byte < 0x80) ? "ok" : "bad";
}

function boxStart(bytes: Buffer, whole: boolean): SegmentStart {
  if (bytes.length < 8) return whole ? "bad" : "more";
  if (!TOP_BOXES.has(bytes.toString("latin1", 4, 8))) return "bad";
  const size = bytes.readUInt32BE(0);
  if (size !== 1) return size >= 8 ? "ok" : "bad";
  if (bytes.length < 16) return whole ? "bad" : "more";
  return bytes.readBigUInt64BE(8) >= 16n ? "ok" : "bad";
}

export { segmentStart, TS_NEED };
export type { SegmentStart };
