// src/infra/openpgp.ts: 고정한 키의 분리 서명만 받는다. 픽스처는 yt-dlp stable 2026.10.26 의 SHA2-256SUMS 와 그 서명, 키는 data/ 의 yt-dlp 서명 키
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pinnedKey, verifyDetached } from "../../src/infra/openpgp.ts";
import { PROJECT } from "../../src/infra/project-paths.ts";

const FINGERPRINT = "AC0C BBE6 848D 6A87 3464 AF4E 57CF 6593 3B5A 7581";
const ARMORED = fs.readFileSync(path.join(PROJECT.root, "data", "yt-dlp-signing-key.asc"), "utf8");
const SUMS = fs.readFileSync(path.join(PROJECT.root, "test", "fixtures", "ytdlp", "SHA2-256SUMS"));
const SIG = fs.readFileSync(path.join(PROJECT.root, "test", "fixtures", "ytdlp", "SHA2-256SUMS.sig"));
const KEY = pinnedKey(ARMORED, FINGERPRINT);

const failsWith = (run: () => void, why: RegExp) => assert.throws(run, (error: { code?: string; message?: string }) => error.code === "BAD_SIGNATURE" && why.test(error.message ?? ""));

/** 서명 패킷 본문이 시작하는 위치(픽스처는 옛 형식 헤더, 길이 2바이트) */
const bodyAt = (sig: Buffer) => {
  assert.equal(sig[0] & 0x40, 0, "옛 형식 헤더");
  return 1 + [1, 2, 4][sig[0] & 3];
};
/** 해시 부분의 하위 패킷마다 형식, 형식 바이트의 위치, 길이 */
function hashedSubpackets(sig: Buffer) {
  const at = bodyAt(sig);
  const end = at + 6 + sig.readUInt16BE(at + 4);
  const out: { type: number; typeAt: number; length: number }[] = [];
  for (let cursor = at + 6; cursor < end;) {
    const length = sig[cursor++];
    assert.ok(length < 192, "픽스처의 하위 패킷은 1바이트 길이");
    out.push({ type: sig[cursor] & 0x7f, typeAt: cursor, length });
    cursor += length;
  }
  return out;
}
const changed = (buf: Buffer, at: number, value: number) => {
  const copy = Buffer.from(buf);
  copy[at] = value;
  return copy;
};

test("yt-dlp 의 SHA2-256SUMS 서명을 고정한 키로 확인한다(공백, 소문자 지문도 같다)", () => {
  verifyDetached(SUMS, SIG, KEY);
  verifyDetached(SUMS, SIG, pinnedKey(ARMORED.replace(/\n/g, "\r\n"), FINGERPRINT.toLowerCase()));
});

test("내용이나 서명 값이 한 바이트라도 바뀌면 거절한다", () => {
  failsWith(() => verifyDetached(changed(SUMS, 10, SUMS[10] ^ 1), SIG, KEY), /서명이 맞지 않음/);
  failsWith(() => verifyDetached(Buffer.concat([SUMS, Buffer.from("\n")]), SIG, KEY), /서명이 맞지 않음/);
  failsWith(() => verifyDetached(SUMS, changed(SIG, SIG.length - 1, SIG[SIG.length - 1] ^ 1), KEY), /서명이 맞지 않음/);
});

test("다른 키가 서명했으면(서명의 지문이 다르면) 확인 전에 거절한다", () => {
  const issuer = hashedSubpackets(SIG).find((one) => one.type === 33)!;
  const other = changed(SIG, issuer.typeAt + 2, SIG[issuer.typeAt + 2] ^ 0xff);
  failsWith(() => verifyDetached(SUMS, other, KEY), /다른 키가 서명함/);
});

test("키 파일의 지문이 고정값과 다르면 키를 쓰지 않는다", () => {
  failsWith(() => pinnedKey(ARMORED, "0000 0000 0000 0000 0000 0000 0000 0000 0000 0000"), /지문이 고정값과 다름/);
  failsWith(() => pinnedKey("not a key", FINGERPRINT), /공개 키 블록이 아님/);
});

test("받지 않는 형식: 다른 해시(SHA-1), 텍스트 문서 서명, 모르는 중요 하위 패킷, 잘린 패킷, 서명 둘", () => {
  const at = bodyAt(SIG);
  failsWith(() => verifyDetached(SUMS, changed(SIG, at + 3, 2), KEY), /받지 않는 서명/);
  failsWith(() => verifyDetached(SUMS, changed(SIG, at + 1, 1), KEY), /받지 않는 서명/);
  const created = hashedSubpackets(SIG).find((one) => one.type === 2)!;
  failsWith(() => verifyDetached(SUMS, changed(SIG, created.typeAt, 0x80 | 99), KEY), /모르는 중요 하위 패킷/);
  failsWith(() => verifyDetached(SUMS, SIG.subarray(0, 100), KEY), /잘린 패킷/);
  failsWith(() => verifyDetached(SUMS, Buffer.concat([SIG, SIG]), KEY), /서명 패킷 하나가 아님/);
});
