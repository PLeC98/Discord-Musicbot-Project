// 소스 종류의 글(rules/text/<언어>/sources): 규격(config/schema/genre-sources)의 모든 종류, 입력란, 이름 묶음을 쓰는 선택지에 글이 있다

import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEC, TYPES, viewField } from "../../../src/config/schema/genre-sources.ts";
import { ruleTextFor } from "../../../src/rules/text/index.ts";
import { LANGUAGES } from "../../../src/rules/languages.ts";

for (const { tag } of LANGUAGES) {
  test(`${tag}: 모든 소스 종류와 입력란에 이름이 있고, 이름 묶음을 쓰는 선택지마다 이름이 있다`, () => {
    const text = ruleTextFor(tag);
    const missing: string[] = [];
    for (const type of TYPES) {
      if (!text.sources[type]?.label) missing.push(type);
      for (const field of SPEC[type].fields) {
        if (!text.sources[type]?.fields[field.key]?.label) missing.push(`${type}.${field.key}`);
        if (field.optionText) for (const value of field.options ?? []) if (!text.options[field.optionText][value]) missing.push(`${type}.${field.key}=${value}`);
      }
    }
    assert.deepEqual(missing, []);
  });
}

test("편집기 표의 입력란: 이름, 설명, 빈 값 이름, 선택지 이름을 채운다", () => {
  const text = ruleTextFor("ko");
  const field = (type: string, key: string) =>
    viewField(
      text,
      type,
      SPEC[type].fields.find((one) => one.key === key)!,
    );
  assert.deepEqual(field("animethemes", "seasonFrom").options?.[0], { value: "Winter", label: "1분기" });
  assert.equal(field("animethemes", "seasonTo").emptyLabel, "그 해 끝까지");
  assert.equal(field("utaitedb", "songTypes").hint, "기본값: Cover", "비웠을 때 받는 곡 종류");
  assert.deepEqual(field("lbradio", "mode").options?.[0], { value: "easy", label: "easy" }, "이름 묶음이 없으면 API 값 그대로");
});
