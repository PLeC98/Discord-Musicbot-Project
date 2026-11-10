// OpenPGP 분리 서명 확인(yt-dlp 의 SHA2-256SUMS.sig). 키 하나를 지문으로 고정하고 그 키의 서명만 받는다. Node 의 crypto 만 쓴다.
// 받는 것: v4 공개 키(RSA), v4 서명(바이너리 문서, RSA, SHA-256/384/512), 서명의 해시 부분에 서명한 키의 지문(issuer fingerprint)이 있을 것.
// 그 밖(다른 알고리즘, 부분 길이 패킷, 모르는 중요 하위 패킷)은 거절한다. 형식은 RFC 4880

import crypto from "node:crypto";

// 기반 층이라 오류 도구(rules)를 부르지 않는다. 코드는 같은 형식(code 필드)
const bad = (why: string) => Object.assign(new Error(`서명 확인 실패: ${why}`), { code: "BAD_SIGNATURE" });

const TAG = { signature: 2, publicKey: 6 } as const;
const RSA = 1;
const BINARY_DOCUMENT = 0;
/** 서명의 해시 알고리즘 번호 → Node 의 이름 */
const HASHES: Record<number, string> = { 8: "sha256", 9: "sha384", 10: "sha512" };
const SUB = { created: 2, issuerKeyId: 16, issuerFingerprint: 33 } as const;
// 중요(critical) 표시가 있어도 받는 하위 패킷. 그 밖의 중요 하위 패킷은 뜻을 모르므로 거절한다(RFC 4880 5.2.3.1)
const KNOWN_CRITICAL = new Set<number>([SUB.created, SUB.issuerKeyId, SUB.issuerFingerprint]);

type Packet = { tag: number; body: Buffer };
/** 고정한 키. fingerprint 는 대문자 16진수 40자 */
type PinnedKey = { fingerprint: string; key: crypto.KeyObject; modulusBytes: number };

/** at 부터 n 바이트가 있어야 한다 */
function need(buf: Buffer, at: number, n: number) {
  if (at < 0 || at + n > buf.length) throw bad("잘린 패킷");
}

/** 패킷을 차례로. 옛 형식, 새 형식 헤더를 읽고 부분 길이, 길이 미정은 거절한다 */
function packetsOf(buf: Buffer): Packet[] {
  const out: Packet[] = [];
  let at = 0;
  while (at < buf.length) {
    const head = buf[at++];
    if (!(head & 0x80)) throw bad("패킷 헤더가 아님");
    let tag: number;
    let length: number;
    if (head & 0x40) {
      tag = head & 0x3f;
      need(buf, at, 1);
      const first = buf[at++];
      if (first < 192) length = first;
      else if (first < 224) {
        need(buf, at, 1);
        length = ((first - 192) << 8) + buf[at++] + 192;
      } else if (first === 255) {
        need(buf, at, 4);
        length = buf.readUInt32BE(at);
        at += 4;
      } else throw bad("부분 길이 패킷");
    } else {
      tag = (head >> 2) & 0x0f;
      const kind = head & 3;
      const size = [1, 2, 4][kind];
      if (size === undefined) throw bad("길이 미정 패킷");
      need(buf, at, size);
      length = size === 1 ? buf[at] : size === 2 ? buf.readUInt16BE(at) : buf.readUInt32BE(at);
      at += size;
    }
    need(buf, at, length);
    out.push({ tag, body: buf.subarray(at, at + length) });
    at += length;
  }
  return out;
}

/** MPI(비트 수 2바이트 + 값) 하나와 다음 위치 */
function mpiAt(buf: Buffer, at: number): { value: Buffer; next: number } {
  need(buf, at, 2);
  const bytes = Math.ceil(buf.readUInt16BE(at) / 8);
  need(buf, at + 2, bytes);
  return { value: buf.subarray(at + 2, at + 2 + bytes), next: at + 2 + bytes };
}

/** ASCII armor 를 벗긴다. 헤더 줄 뒤의 빈 줄까지 건너뛰고, 끝의 체크섬 줄(=로 시작)은 뺀다 */
function dearmor(text: string): Buffer {
  const lines = text.replace(/\r/g, "").split("\n");
  const begin = lines.findIndex((line) => line.trim() === "-----BEGIN PGP PUBLIC KEY BLOCK-----");
  const end = lines.findIndex((line) => line.trim() === "-----END PGP PUBLIC KEY BLOCK-----");
  if (begin < 0 || end < begin) throw bad("공개 키 블록이 아님");
  const body = lines.slice(begin + 1, end);
  const blank = body.findIndex((line) => !line.trim());
  if (blank < 0) throw bad("공개 키 블록에 헤더 끝이 없음");
  return Buffer.from(
    body
      .slice(blank + 1)
      .filter((line) => !line.startsWith("="))
      .join(""),
    "base64",
  );
}

/** v4 키 지문: SHA-1(0x99, 본문 길이 2바이트, 공개 키 패킷 본문) */
function fingerprintOf(body: Buffer) {
  const head = Buffer.from([0x99, body.length >> 8, body.length & 0xff]);
  return crypto.createHash("sha1").update(head).update(body).digest("hex").toUpperCase();
}

/** armored 공개 키에서 첫 공개 키 패킷(v4 RSA)을 읽고, 그 지문이 fingerprint(공백 무시)와 같을 때만 돌려준다 */
function pinnedKey(armored: string, fingerprint: string): PinnedKey {
  const want = fingerprint.replace(/\s/g, "").toUpperCase();
  const packet = packetsOf(dearmor(armored)).find((one) => one.tag === TAG.publicKey);
  if (!packet) throw bad("공개 키 패킷이 없음");
  const body = packet.body;
  need(body, 0, 6);
  if (body[0] !== 4 || body[5] !== RSA) throw bad(`받지 않는 공개 키(v${body[0]}, 알고리즘 ${body[5]})`);
  const got = fingerprintOf(body);
  if (got !== want) throw bad(`공개 키의 지문이 고정값과 다름(${got})`);
  const n = mpiAt(body, 6);
  const e = mpiAt(body, n.next);
  const key = crypto.createPublicKey({ key: { kty: "RSA", n: n.value.toString("base64url"), e: e.value.toString("base64url") }, format: "jwk" });
  return { fingerprint: got, key, modulusBytes: n.value.length };
}

/** 해시 부분의 하위 패킷에서 서명한 키의 지문. 모르는 중요 하위 패킷이 있으면 거절한다 */
function issuerOf(hashed: Buffer): string | null {
  let issuer: string | null = null;
  for (let at = 0; at < hashed.length;) {
    let length = hashed[at++];
    if (length >= 192 && length < 255) {
      need(hashed, at, 1);
      length = ((length - 192) << 8) + hashed[at++] + 192;
    } else if (length === 255) {
      need(hashed, at, 4);
      length = hashed.readUInt32BE(at);
      at += 4;
    }
    need(hashed, at, length);
    if (length < 1) throw bad("빈 하위 패킷");
    const type = hashed[at] & 0x7f;
    if (hashed[at] & 0x80 && !KNOWN_CRITICAL.has(type)) throw bad(`모르는 중요 하위 패킷(${type})`);
    // 본문: 키 버전 1바이트(4) + 지문 20바이트
    if (type === SUB.issuerFingerprint && length === 22 && hashed[at + 1] === 4)
      issuer = hashed
        .subarray(at + 2, at + 22)
        .toString("hex")
        .toUpperCase();
    at += length;
  }
  return issuer;
}

/**
 * data 에 대한 분리 서명(바이너리, 패킷 하나)을 고정한 키로 확인한다. 맞으면 돌아오고, 아니면 BAD_SIGNATURE 로 던진다.
 * 까닭은 메시지에 싣는다: 다른 키가 서명함(키 교체일 수 있다), 서명이 맞지 않음(내용이나 서명이 바뀌었다), 받지 않는 형식
 */
function verifyDetached(data: Buffer, signature: Buffer, pinned: PinnedKey): void {
  const packets = packetsOf(signature);
  if (packets.length !== 1 || packets[0].tag !== TAG.signature) throw bad("서명 패킷 하나가 아님");
  const body = packets[0].body;
  need(body, 0, 6);
  const [version, type, algorithm, hashId] = [body[0], body[1], body[2], body[3]];
  const hash = HASHES[hashId];
  if (version !== 4 || type !== BINARY_DOCUMENT || algorithm !== RSA || !hash) throw bad(`받지 않는 서명(v${version}, 형식 ${type}, 알고리즘 ${algorithm}, 해시 ${hashId})`);
  const hashedLength = body.readUInt16BE(4);
  need(body, 6, hashedLength + 2);
  const issuer = issuerOf(body.subarray(6, 6 + hashedLength));
  if (!issuer) throw bad("서명한 키의 지문이 없음");
  if (issuer !== pinned.fingerprint) throw bad(`다른 키가 서명함(${issuer})`);
  const unhashedLength = body.readUInt16BE(6 + hashedLength);
  const after = 6 + hashedLength + 2 + unhashedLength;
  need(body, after, 2);
  const left16 = body.subarray(after, after + 2);
  const value = mpiAt(body, after + 2).value;
  if (value.length > pinned.modulusBytes) throw bad("서명 값이 키보다 큼");
  // 서명한 것: 문서 + 서명 패킷의 앞부분(버전부터 해시 부분 끝까지) + 트레일러(04 FF, 그 길이 4바이트)
  const trailer = Buffer.alloc(6);
  trailer[0] = 4;
  trailer[1] = 0xff;
  trailer.writeUInt32BE(6 + hashedLength, 2);
  const signed = Buffer.concat([data, body.subarray(0, 6 + hashedLength), trailer]);
  if (!crypto.createHash(hash).update(signed).digest().subarray(0, 2).equals(left16)) throw bad("서명이 맞지 않음");
  // MPI 는 앞의 0 을 떼고 싣는다. RSA 확인은 키 길이만큼 채운 값을 받는다
  const padded = Buffer.concat([Buffer.alloc(pinned.modulusBytes - value.length), value]);
  if (!crypto.verify(hash, signed, { key: pinned.key, padding: crypto.constants.RSA_PKCS1_PADDING }, padded)) throw bad("서명이 맞지 않음");
}

export { pinnedKey, verifyDetached };
export type { PinnedKey };
