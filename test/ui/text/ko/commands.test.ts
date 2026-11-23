// locales/ko/bot/commands.ts, src/ui/command-localizations.ts: 어떤 언어에서 빠진 명령 문구는 그 언어의 로케일 키로 싣지 않는다.
// 한국어 문구표에서 일부를 뺀 사본을 다른 언어로 보고 확인한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS } from "../../../../src/discord/commands/index.ts";
import { localizeCommand, type LocaleText } from "../../../../src/ui/command-localizations.ts";
import { fillFrom } from "../../../../src/infra/text-fill.ts";
import { WHOLE_MODULES } from "../../../../src/ui/text/bundle.ts";
import { textFor } from "../../../../src/ui/text/index.ts";
import * as ko from "../../../../locales/ko/bot/index.ts";

const KO = textFor("ko").commands;
type Entry = { description: string; options?: Record<string, { name: string; description: string; choices?: Record<string, string> }> };
type Node = { name: string; description_localizations?: Record<string, string>; name_localizations?: Record<string, string>; options?: Node[] };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Node;

test("어떤 언어에서 빠진 명령 문구는 그 언어의 로케일 키로 싣지 않는다(디스코드가 기본값을 보여 준다). 빠진 경로는 문구표의 안쪽 키까지 적힌다", () => {
  const partial = structuredClone(ko.commands) as Record<string, Entry>;
  delete (partial.play.options?.query as Partial<{ name: string }>).name;
  delete partial.seek.options;
  const { missing } = fillFrom(ko, { ...ko, commands: partial }, WHOLE_MODULES);
  assert.deepEqual(missing.sort(), ["commands.play.options.query.name", "commands.seek.options"]);

  const other: LocaleText = { commands: KO, locales: ["en-US"], missing };
  const texts = [{ commands: KO, locales: ["ko"], missing: [] }, other];
  const play = json(
    localizeCommand(
      COMMANDS.find((command) => command.name === "play")!
        .data(KO)
        .toJSON(),
      texts,
    ),
  );
  assert.equal(play.description_localizations?.["en-US"], KO.play.description, "빠지지 않은 설명은 싣는다");
  assert.deepEqual(Object.keys(play.options?.[0].name_localizations ?? {}), ["ko"], "빠진 옵션 이름은 싣지 않는다");
  assert.ok(play.options?.[0].description_localizations?.["en-US"], "같은 옵션의 설명은 싣는다");
  const seek = json(
    localizeCommand(
      COMMANDS.find((command) => command.name === "seek")!
        .data(KO)
        .toJSON(),
      texts,
    ),
  );
  assert.deepEqual(Object.keys(seek.options?.[0].description_localizations ?? {}), ["ko"], "통째로 빠진 옵션의 문구는 싣지 않는다");
});
