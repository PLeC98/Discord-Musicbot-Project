// 슬래시 명령 정의(배포 JSON)에 언어마다의 문구를 싣는다. 기본값(설명, 선택지 이름)은 명령 파일이 봇 기본 언어의 문구표로 만든다(discord/commands).
// 여기서는 번역이 있는 언어마다 그 언어로 받는 디스코드 로케일 키로 *_localizations를 단다. 기본 언어도 그 언어의 로케일 키로 싣는다
// (싣지 않으면 en-US 사용자가 en-GB 값을 보는 식으로 디스코드가 다른 로케일로 폴백한다).
// 그 언어에 빠진 문구(기준 언어로 채운 것)는 싣지 않아 디스코드가 기본값(봇 기본 언어)을 보여 준다

import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { LANGUAGES, type TextLanguage } from "../rules/languages.ts";
import { missingText, textFor, type BotText } from "./text/index.ts";

/** 명령 문구표(ui/text/<언어>/commands) */
type CommandsText = BotText["commands"];
/** 한 언어: 문구표, 그 언어로 받는 디스코드 로케일, 빠진(기준 언어로 채운) 문구의 경로 */
type LocaleText = { commands: CommandsText; locales: readonly string[]; missing: readonly string[] };

/** 번역이 있는 언어마다의 명령 문구. 테스트 언어는 받는 디스코드 로케일이 없어 넣지 않는다 */
function localeTexts(): LocaleText[] {
  const missing = missingText();
  return LANGUAGES.map((one) => ({ commands: textFor(one.tag as TextLanguage).commands, locales: one.discord, missing: missing.get(one.tag as TextLanguage) ?? [] }));
}

// 정의에서 읽고 다는 필드
type Choice = { name: string; value: string | number; name_localizations?: Record<string, string> | null };
type Node = { name: string; description?: string; name_localizations?: Record<string, string> | null; description_localizations?: Record<string, string> | null; options?: Node[]; choices?: Choice[] };
/** 문구표의 명령 하나, 옵션 하나(모양만) */
type CommandEntry = { description: string; options?: Record<string, OptionEntry> };
type OptionEntry = { name: string; description: string; choices?: Record<string, string> };

/** 경로(commands.이름.…)의 문구를 언어마다 로케일 키로. 그 언어에 빠졌거나 없으면 싣지 않는다 */
function localizationsOf(texts: readonly LocaleText[], path: string[], pick: (commands: CommandsText) => string | undefined) {
  const at = ["commands", ...path].join(".");
  const entries = texts.flatMap(({ commands, locales, missing }) => {
    if (missing.some((one) => at === one || at.startsWith(`${one}.`))) return [];
    const text = pick(commands);
    return text === undefined ? [] : locales.map((locale) => [locale, text] as const);
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

const entryOf = (commands: CommandsText, name: string) => (commands as Record<string, CommandEntry | undefined>)[name];

/** 명령 하나의 정의에 언어마다의 설명, 옵션 이름과 설명, 선택지 이름을 단다(옵션 안의 옵션은 없다) */
function localizeCommand(json: RESTPostAPIApplicationCommandsJSONBody, texts: readonly LocaleText[] = localeTexts()): RESTPostAPIApplicationCommandsJSONBody {
  const command = json as Node;
  const name = command.name;
  const options = (command.options ?? []).map((option) => {
    const optionOf = (commands: CommandsText) => entryOf(commands, name)?.options?.[option.name];
    const path = [name, "options", option.name];
    const choices = option.choices?.map((choice) => ({ ...choice, name_localizations: localizationsOf(texts, [...path, "choices", String(choice.value)], (commands) => optionOf(commands)?.choices?.[String(choice.value)]) }));
    return {
      ...option,
      name_localizations: localizationsOf(texts, [...path, "name"], (commands) => optionOf(commands)?.name),
      description_localizations: localizationsOf(texts, [...path, "description"], (commands) => optionOf(commands)?.description),
      ...(choices ? { choices } : {}),
    };
  });
  return {
    ...json,
    description_localizations: localizationsOf(texts, [name, "description"], (commands) => entryOf(commands, name)?.description),
    ...(command.options ? { options } : {}),
  } as RESTPostAPIApplicationCommandsJSONBody;
}

export { localizeCommand, localeTexts };
export type { CommandsText, LocaleText };
