// src/sources/ytdlp-cli-args.ts: pnpm run update:ytdlp의 인자(--pin, --unpin, --channel, --skip-signature)

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpdateArgs } from "../../src/sources/ytdlp-cli-args.ts";

test("인자가 없으면 고정과 채널을 바꾸지 않는다", () => {
  assert.deepEqual(parseUpdateArgs([]), { pin: undefined, channel: undefined, skipSignature: false });
  assert.deepEqual(parseUpdateArgs(["--", "--skip-signature"]), { pin: undefined, channel: undefined, skipSignature: true });
});

test("--pin 태그, --pin=태그 모두 그 태그로 고정한다", () => {
  assert.deepEqual(parseUpdateArgs(["--pin", "2026.11.16.232655"]), { pin: "2026.11.16.232655", channel: undefined, skipSignature: false });
  assert.deepEqual(parseUpdateArgs(["--pin=2026.10.26", "--skip-signature"]), { pin: "2026.10.26", channel: undefined, skipSignature: true });
});

test("--unpin은 고정을 푼다", () => {
  assert.deepEqual(parseUpdateArgs(["--unpin"]), { pin: null, channel: undefined, skipSignature: false });
});

test("태그가 없거나 모양이 틀리거나 --unpin과 같이 쓰면 오류", () => {
  assert.ok("error" in parseUpdateArgs(["--pin"]));
  assert.ok("error" in parseUpdateArgs(["--pin", "--skip-signature"]), "다음 인자가 태그가 아니다");
  assert.ok("error" in parseUpdateArgs(["--pin", "latest"]));
  assert.ok("error" in parseUpdateArgs(["--pin", "2026.10.26", "--unpin"]));
});

test("--channel 채널, --channel=채널은 채널을 바꾸고 --pin, --unpin과 함께 쓴다", () => {
  assert.deepEqual(parseUpdateArgs(["--channel", "stable"]), { pin: undefined, channel: "stable", skipSignature: false });
  assert.deepEqual(parseUpdateArgs(["--", "--channel=master", "--unpin"]), { pin: null, channel: "master", skipSignature: false });
  assert.deepEqual(parseUpdateArgs(["--channel", "stable", "--pin", "2026.10.26"]), { pin: "2026.10.26", channel: "stable", skipSignature: false });
});

test("--channel 뒤에 채널이 없거나 모르는 채널이면 오류", () => {
  assert.ok("error" in parseUpdateArgs(["--channel"]));
  assert.ok("error" in parseUpdateArgs(["--channel", "--unpin"]), "다음 인자가 채널이 아니다");
  assert.ok("error" in parseUpdateArgs(["--channel", "beta"]));
});
