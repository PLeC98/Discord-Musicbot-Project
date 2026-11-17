// pnpm run update:ytdlp의 인자

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUpdateArgs } from "../../src/sources/ytdlp-cli-args.ts";

test("인자가 없으면 고정을 바꾸지 않는다", () => {
  assert.deepEqual(parseUpdateArgs([]), { pin: undefined, skipSignature: false });
  assert.deepEqual(parseUpdateArgs(["--", "--skip-signature"]), { pin: undefined, skipSignature: true });
});

test("--pin 태그, --pin=태그 모두 그 태그로 고정한다", () => {
  assert.deepEqual(parseUpdateArgs(["--pin", "2026.11.16.232655"]), { pin: "2026.11.16.232655", skipSignature: false });
  assert.deepEqual(parseUpdateArgs(["--pin=2026.10.26", "--skip-signature"]), { pin: "2026.10.26", skipSignature: true });
});

test("--unpin은 고정을 푼다", () => {
  assert.deepEqual(parseUpdateArgs(["--unpin"]), { pin: null, skipSignature: false });
});

test("태그가 없거나 모양이 틀리거나 --unpin과 같이 쓰면 오류", () => {
  assert.ok("error" in parseUpdateArgs(["--pin"]));
  assert.ok("error" in parseUpdateArgs(["--pin", "--skip-signature"]), "다음 인자가 태그가 아니다");
  assert.ok("error" in parseUpdateArgs(["--pin", "latest"]));
  assert.ok("error" in parseUpdateArgs(["--pin", "2026.10.26", "--unpin"]));
});
