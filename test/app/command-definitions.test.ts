// src/discord/commands, src/ui/command-localizations.ts: 슬래시 명령 정의(배포하는 JSON)와 언어마다의 명령 문구(ui/text/<언어>/commands).
// 기본값(설명, 이름, 선택지)은 고정한 정의(fixtures/commands/definitions-ko.json)와 같고, 언어마다의 문구는 그 언어가 받는 디스코드 로케일 키로 실린다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Locale, type RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { COMMANDS } from "../../src/discord/commands/index.ts";
import { definitions } from "../../src/app/command-loader.ts";
import { localizeCommand } from "../../src/ui/command-localizations.ts";
import { textFor } from "../../src/ui/text/index.ts";
import { LANGUAGES, type TextLanguage } from "../../src/rules/languages.ts";
import { withConfig } from "../helpers/config.ts";

const FIXTURE = path.join(import.meta.dirname, "..", "fixtures", "commands", "definitions-ko.json");
const KO = textFor("ko").commands;

type Choice = { name: string; value: string | number; name_localizations?: Record<string, string> };
type Node = { name: string; description: string; name_localizations?: Record<string, string>; description_localizations?: Record<string, string>; options?: Node[]; choices?: Choice[] };
type Entry = { description: string; options?: Record<string, { name: string; description: string; choices?: Record<string, string> }> };

const json = (value: RESTPostAPIApplicationCommandsJSONBody) => JSON.parse(JSON.stringify(value)) as Node;
const localized = (C: typeof KO) => COMMANDS.map((command) => json(localizeCommand(command.data(C).toJSON())));

// 지역화로 더한 키(설명, 선택지 이름)를 뺀다. 옵션 이름의 지역화는 전에도 있었다
function withoutAdded(node: Node): Node {
  const { description_localizations: _d, ...rest } = node;
  return {
    ...rest,
    ...(node.options ? { options: node.options.map(withoutAdded) } : {}),
    ...(node.choices ? { choices: node.choices.map(({ name_localizations: _n, ...choice }) => choice) } : {}),
  } as Node;
}

test("한국어 문구로 만든 정의는 고정한 것과 같고(지역화로 더한 키 빼고), 한국어 지역화는 기본값과 같다", () => {
  const made = localized(KO);
  assert.deepEqual(made.map(withoutAdded), JSON.parse(fs.readFileSync(FIXTURE, "utf8")));
  const wrong: string[] = [];
  const visit = (n: Node, at: string) => {
    if (n.description_localizations?.ko !== n.description) wrong.push(`${at} 설명`);
    for (const o of n.options ?? []) {
      if (!o.name_localizations?.ko) wrong.push(`${at} ${o.name} 이름`);
      visit(o, `${at} ${o.name}`);
    }
    for (const c of n.choices ?? []) if (c.name_localizations?.ko !== c.name) wrong.push(`${at}=${c.value}`);
  };
  for (const n of made) visit(n, `/${n.name}`);
  assert.deepEqual(wrong, []);
});

test("명령 모듈의 이름은 정의의 이름과 같다", () => {
  assert.deepEqual(
    COMMANDS.map((command) => command.name),
    COMMANDS.map((command) => command.data(KO).toJSON().name),
  );
});

// 디스코드 규칙: 옵션 이름은 32자 이내, 글자, 숫자, -, _만, 소문자가 있는 글자는 소문자. 설명과 선택지 이름은 1~100자
const OPTION_NAME = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;
const LOCALES = new Set<string>(Object.values(Locale));

for (const language of LANGUAGES) {
  const C = textFor(language.tag as TextLanguage).commands;
  const table = C as Record<string, Entry>;

  test(`${language.tag}: 문구표와 명령 정의가 서로 빠짐없이 맞고, 디스코드 규칙(길이, 옵션 이름, 로케일)을 지킨다`, () => {
    const wrong: string[] = [];
    const names = new Set(COMMANDS.map((command) => command.name));
    for (const extra of Object.keys(table).filter((name) => !names.has(name))) wrong.push(`문구표에만 /${extra}`);
    for (const command of COMMANDS) {
      const defined = json(command.data(C).toJSON());
      const entry = table[command.name];
      if (!entry) {
        wrong.push(`/${command.name} 문구 없음`);
        continue;
      }
      if (entry.description.length < 1 || entry.description.length > 100) wrong.push(`/${command.name} 설명 길이`);
      const options = defined.options ?? [];
      assert.deepEqual(Object.keys(entry.options ?? {}).sort(), options.map((o) => o.name).sort(), `/${command.name} 옵션`);
      const shown = new Set<string>();
      for (const option of options) {
        const text = entry.options?.[option.name];
        if (!text) continue;
        const at = `/${command.name} ${option.name}`;
        if (!OPTION_NAME.test(text.name) || text.name !== text.name.toLowerCase()) wrong.push(`${at} 이름 ${text.name}`);
        if (shown.has(text.name)) wrong.push(`${at} 이름 겹침`);
        shown.add(text.name);
        if (text.description.length < 1 || text.description.length > 100) wrong.push(`${at} 설명 길이`);
        assert.deepEqual(Object.keys(text.choices ?? {}).sort(), (option.choices ?? []).map((c) => String(c.value)).sort(), `${at} 선택지`);
        for (const name of Object.values(text.choices ?? {})) if (name.length < 1 || name.length > 100) wrong.push(`${at} 선택지 ${name}`);
      }
    }
    for (const locale of language.discord) if (!LOCALES.has(locale)) wrong.push(`디스코드 로케일이 아님: ${locale}`);
    assert.deepEqual(wrong, []);
  });
}

test("테스트 언어를 켜면 /language만 더해진다(언어가 둘이 된다). 다른 명령의 정의는 같다(테스트 언어는 디스코드 로케일이 없다)", () => {
  const names = (on: boolean) => withConfig({ i18n: { testLanguage: on } }, () => definitions()).map((one) => one.name);
  const others = (on: boolean) => withConfig({ i18n: { testLanguage: on } }, () => JSON.stringify(definitions().filter((one) => one.name !== "language")));
  assert.deepEqual(
    names(true).filter((name) => !names(false).includes(name)),
    ["language"],
  );
  assert.equal(others(true), others(false));
});
