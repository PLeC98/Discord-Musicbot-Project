// src/config/documents.ts · store/settings-docs.ts — 설정 문서(장르 · 상태 문구 · AI 설정 · 프롬프트).
// 메모리에 들고 있다가 저장하면 settings.db 에 쓴다. 저장 번호가 다르면 거절하고, 함께 쓰는 문서는 한 트랜잭션이다.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as documents from "../../src/config/documents.ts";
import * as settingsDocs from "../../src/store/settings-docs.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";

const store = openTempStore("documents-");
beforeEach(() => {
  store.settings().exec("DELETE FROM documents");
  documents.attach(settingsDocs);
});
after(() => {
  useDefaultDocuments();
  store.close();
});

const conflict = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return codeOf(error) === "REVISION_CONFLICT";
  }
  return false;
};

test("저장한 적 없으면 기본 문서, 번호 0", () => {
  assert.deepEqual(documents.get("genres"), documents.defaultOf("genres"));
  assert.equal(documents.revisionOf("genres"), 0);
  assert.deepEqual(documents.get("ai-prompt"), [], "비면 보조가 코드에 든 기본 구성을 쓴다");
});

test("저장하면 DB 에 남고, 다시 붙여도(기동) 그 값이 올라온다", () => {
  const next = documents.put("status", { interval: 30, messages: ["저장한 문구"] }, 0);
  assert.equal(next, 1);
  assert.deepEqual(settingsDocs.read("status"), { data: { interval: 30, messages: ["저장한 문구"] }, revision: 1 });

  documents._use();
  documents.attach(settingsDocs);
  assert.deepEqual(documents.get("status"), { interval: 30, messages: ["저장한 문구"] });
  assert.equal(documents.revisionOf("status"), 1);
});

test("낡은 번호로 저장하면 거절하고 아무것도 바꾸지 않는다", () => {
  documents.put("genres", { genres: {} }, 0);
  const kept = structuredClone(documents.get("genres"));
  assert.ok(conflict(() => documents.put("genres", { genres: { 덮임: {} } }, 0)));
  assert.deepEqual(documents.get("genres"), kept);
  assert.equal(settingsDocs.read("genres").revision, 1);
});

// AI 설정과 프롬프트는 화면의 저장 하나로 함께 바뀐다. 반만 쓰이면 둘이 어긋난다
test("함께 저장: 하나라도 실패하면 둘 다 쓰지 않는다(메모리 · DB 모두)", () => {
  documents.put("ai", { provider: "off", model: "처음" }, 0);

  // 다른 쪽이 그사이 DB 의 프롬프트를 고쳤다: 메모리는 번호 0 으로 알고 써서 DB 에서 걸린다
  settingsDocs.write("ai-prompt", [{ role: "user", text: "{{목록}} 바깥" }], 0);
  assert.ok(
    conflict(() =>
      documents.putAll([
        { name: "ai", data: { provider: "off", model: "반만" }, revision: 1 },
        { name: "ai-prompt", data: [] },
      ]),
    ),
  );

  assert.deepEqual(settingsDocs.read("ai"), { data: { provider: "off", model: "처음" }, revision: 1 }, "앞 문서도 되돌린다");
  assert.equal((documents.get("ai") as { model: string }).model, "처음");
  assert.deepEqual(documents.get("ai-prompt"), []);
});

test("함께 저장: 번호를 안 준 문서는 번호를 보지 않는다. 새 번호를 같은 차례로 돌려준다", () => {
  documents.put("ai-prompt", [{ role: "user", text: "{{목록}}" }], 0);
  const next = documents.putAll([
    { name: "ai", data: { provider: "off" }, revision: 0 },
    { name: "ai-prompt", data: [{ role: "user", text: "{{목록}} 새로" }] },
  ]);
  assert.deepEqual(next, [1, 2]);
  assert.deepEqual(settingsDocs.read("ai-prompt").data, [{ role: "user", text: "{{목록}} 새로" }]);
});

test("DB 에 망가진 문서가 있으면 없는 것으로 읽고 기본 문서로 돈다", () => {
  store.settings().prepare("INSERT INTO documents (name, data_json, revision) VALUES ('status', '{깨짐', 3)").run();
  documents.attach(settingsDocs);
  assert.deepEqual(documents.get("status"), documents.defaultOf("status"));
  assert.equal(documents.revisionOf("status"), 3, "다음 저장은 번호 3 에 이어서");
});
