// src/store/ai-keys.ts — AI 키는 비밀 표에 주소와 함께 묶인다. 옛 키 파일은 읽지 않고 남아 있으면 알린다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openTempStore } from "../helpers/temp-store.ts";
import * as aiKeys from "../../src/store/ai-keys.ts";
import * as secrets from "../../src/store/secrets.ts";
import sink from "../../src/infra/log/sink.ts";

const store = openTempStore("ai-keys-");
secrets._useKey(Buffer.alloc(32, 7).toString("base64"));
after(() => {
  secrets._useKey();
  store.close();
});

test("묶인 주소로만 나온다. 상태는 none · ok · moved", () => {
  assert.equal(aiKeys.stateOf("openai", "https://api.openai.com/v1"), "none");
  aiKeys.put("openai", "sk-openai-0123456789", "https://api.openai.com/v1");
  assert.equal(aiKeys.read("openai", "https://api.openai.com/v1"), "sk-openai-0123456789");
  assert.equal(aiKeys.read("openai", "https://evil.example/v1"), "");
  assert.equal(aiKeys.stateOf("openai", "https://evil.example/v1"), "moved");
  assert.deepEqual(aiKeys.allValues(["openai", "groq"]), ["sk-openai-0123456789"]);
  aiKeys.remove("openai");
  assert.equal(aiKeys.stateOf("openai", "https://api.openai.com/v1"), "none");
});

test("옛 키 파일(config/ai-keys.yaml)이 남아 있으면 기동 때 한 줄. 비었으면 말하지 않는다", () => {
  const dir = path.join(store.dir, "config");
  fs.mkdirSync(dir, { recursive: true });
  const said = () => sink.buffer.filter((e) => e.text.startsWith("config/ai-keys.yaml 은 이제 읽지 않습니다")).length;
  const before = said();
  fs.writeFileSync(path.join(dir, "ai-keys.yaml"), "");
  aiKeys.warnLegacyFile(dir);
  assert.equal(said(), before);
  fs.writeFileSync(path.join(dir, "ai-keys.yaml"), "openai: sk-old\n");
  aiKeys.warnLegacyFile(dir);
  assert.equal(said(), before + 1);
});
