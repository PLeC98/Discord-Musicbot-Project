// 누가 보는가로 언어를 고른다. 여럿이 보는 것(채널에 남는 공개 메시지)은 서버 언어, 개인이 보는 것(본인에게만 보이는 답, 대시보드 화면)은 그 사람의 언어.
// 호출부는 언어를 직접 정하지 않고 보낼 곳의 독자에 맞는 함수를 부른다. 언어를 돌려주는 함수(그리기 워커의 일감에 실을 수 있다)와 그 언어의 문구표를 주는 함수가 짝이다.
// 저장한 언어(봇 기본 언어, 서버 언어, 개인 언어)가 지금 쓸 수 없는 언어면(언어가 빠졌거나 테스트 언어가 저장된 경우) 한 번 알리고 다음 순서로 넘어간다

import { MessageFlags } from "discord.js";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { BASE_LANGUAGE, acceptedTags, availableLanguages, discordLanguage, infoOf, isAvailable, matchLanguage, type Language } from "../rules/languages.ts";
import * as guildSettings from "../store/guild-settings.ts";
import * as userSettings from "../store/user-settings.ts";
import { textFor } from "./text/index.ts";
import { L } from "../infra/log/text.ts";

const log = logger.child({ category: "core" });

/** 지금 쓸 수 있는 언어 */
const languagesNow = () => availableLanguages();

// 이미 알린 쓸 수 없는 저장 값(어디, 값)
const warned = new Set<string>();

/** 저장한 곳: 봇 기본 언어, 서버 언어(서버 ID), 개인 언어(사용자 ID) */
type Saved = { kind: "bot" } | { kind: "guild" | "user"; id: string };

/** 저장한 언어가 지금 쓸 수 있으면 그 언어, 아니면 null */
function usable(tag: string | null, saved: Saved): Language | null {
  if (tag === null) return null;
  if (isAvailable(tag, languagesNow())) return tag;
  const key = `${saved.kind}|${"id" in saved ? saved.id : ""}|${tag}`;
  if (!warned.has(key)) {
    warned.add(key);
    log.warn(L.core.savedLanguageUnavailable({ kind: saved.kind, id: "id" in saved ? saved.id : "", tag }));
  }
  return null;
}

/** 봇 기본 언어: 서버 언어도 개인 언어도 정해지지 않았을 때(운영 설정값). 쓸 수 없으면 기준 언어 */
const botLanguage = (): Language => usable(config.i18n.botLanguage, { kind: "bot" }) ?? BASE_LANGUAGE;

/** 서버 언어: 서버가 고른 언어 → 봇 기본 언어. 서버 정보가 없으면(guildId 없음) 봇 기본 언어 */
function guildLanguage(guildId: string | null | undefined): Language {
  if (!guildId) return botLanguage();
  return usable(guildSettings.resolveLanguage(guildId), { kind: "guild", id: guildId }) ?? botLanguage();
}

/** 상호작용에서 언어를 고르는 데 쓰는 것 */
type Asker = { locale?: string | null; guildId: string | null; user?: { id: string } | null; message?: { flags: { has(flag: MessageFlags): boolean } } | null };

/** 개인 언어가 자동일 때(정한 적 없음, 직접 고른 자동)의 언어: 디스코드 앱 언어(지원하는 언어일 때) → 서버 언어(서버 안일 때) → 봇 기본 언어 */
function autoLanguage(asker: Asker): Language {
  return discordLanguage(asker.locale, languagesNow()) ?? (asker.guildId ? guildLanguage(asker.guildId) : botLanguage());
}

/** 그 사람이 고른 언어. 정한 적 없음, 직접 고른 자동, 쓸 수 없는 언어면 null */
function chosenLanguage(userId: string | null | undefined): Language | null {
  if (!userId) return null;
  const chosen = userSettings.languageOf(userId);
  return chosen === null || chosen === "auto" ? null : usable(chosen, { kind: "user", id: userId });
}

/** 개인(디스코드 사용자)의 언어: 개인 언어(언어를 골랐을 때) → 자동(autoLanguage) */
function personLanguage(asker: Asker): Language {
  return chosenLanguage(asker.user?.id) ?? autoLanguage(asker);
}

/** 기존 메시지를 수정할 때: 그 메시지가 본인에게만 보이는 것이면 개인, 아니면 서버. 메시지가 없는 상호작용(명령, 명령에서 연 모달)은 개인 */
function audienceLanguage(asker: Asker): Language {
  const shared = asker.message && !asker.message.flags.has(MessageFlags.Ephemeral);
  return shared && asker.guildId ? guildLanguage(asker.guildId) : personLanguage(asker);
}

/** 대시보드를 보는 사람의 언어: 개인 언어(로그인했고 언어를 골랐을 때) → Accept-Language(브라우저 언어 목록) → 봇 기본 언어 */
function viewerLanguage({ userId, acceptLanguage }: { userId?: string | null; acceptLanguage?: string | null }): Language {
  return chosenLanguage(userId) ?? matchLanguage(acceptedTags(acceptLanguage), languagesNow()) ?? botLanguage();
}

/** 서버의 공개 메시지에 쓸 문구표 */
const publicText = (guildId: string | null | undefined) => textFor(guildLanguage(guildId));
/** 본인에게만 보이는 답에 쓸 문구표 */
const privateText = (asker: Asker) => textFor(personLanguage(asker));
/** 기존 메시지를 수정할 때 쓸 문구표 */
const audienceText = (asker: Asker) => textFor(audienceLanguage(asker));
/** 봇이 만든 글(선택지 이름 등)이 입력으로 돌아왔을 때 되읽어 볼 문구표들. 어느 언어로 만든 것인지 모르므로 그 사람의 언어부터 쓸 수 있는 모든 언어 */
function readingTexts(asker: Asker) {
  const first = personLanguage(asker);
  return [
    first,
    ...languagesNow()
      .map((one) => one.tag as Language)
      .filter((tag) => tag !== first),
  ].map((tag) => textFor(tag));
}

// 로케일마다 한 번 만드는 이름 비교
const collators = new Map<string, Intl.Collator>();

/** 서버 쪽 정렬(서버 목록, 프로세스, 캐시 DB)의 이름 비교. 봇 기본 언어의 형식 로케일을 쓴다(쪽 나눔과 엮여 있어 보는 사람마다 바꾸지 않는다) */
function botCompare(a: string, b: string): number {
  const locale = infoOf(botLanguage()).locale;
  let collator = collators.get(locale);
  if (!collator) collators.set(locale, (collator = new Intl.Collator(locale)));
  return collator.compare(a, b);
}

export { botCompare, botLanguage, guildLanguage, autoLanguage, personLanguage, audienceLanguage, viewerLanguage, publicText, privateText, audienceText, readingTexts, languagesNow };
export type { Asker };
