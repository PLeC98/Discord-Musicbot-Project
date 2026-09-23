"use strict";

// 설정 파일 스키마가 같이 쓰는 도우미. 스키마는 문제 목록만 낸다. 던질지 경고할지는 부르는 쪽이 정한다.

const { z } = require("zod");

const ALWAYS = { when: () => true }; // 칸 하나가 틀려도 교차 검사를 돌린다. 문제를 한 번에 다 알린다

// 있으면(null · undefined 가 아니면) 조건을 본다. 문구는 그대로 쓰거나 값을 받아 만든다
const present = (ok, message) =>
  z
    .unknown()
    .refine((v) => v == null || ok(v), { error: message })
    .optional();

// 이름을 붙인 목록을 Object.keys 로 읽던 것과 같게: 무엇이 오든 키 → 값 표로
const keyed = (v) => Object.fromEntries(Object.keys(v || {}).map((k) => [k, v[k]]));

// 표가 아니면 빈 표로(값이 없던 것과 같게 읽는다)
const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/**
 * 검사 결과 → 문구 목록. 문구 안의 {자리}는 오류가 난 곳(path)으로 채운다.
 * fill(path) 는 { 자리 이름: 값 } 을 돌려준다.
 */
function problemsOf(schema, data, fill = () => ({})) {
  const result = schema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const slots = fill(issue.path);
    return issue.message.replace(/\{(\w+)\}/g, (m, name) => (name in slots ? slots[name] : m));
  });
}

module.exports = { z, ALWAYS, present, keyed, plain, problemsOf };
