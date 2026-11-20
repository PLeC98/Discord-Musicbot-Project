// 누가 보는가로 언어를 고른다. 여럿이 보는 것(채널에 남는 공개 메시지)은 서버 언어, 개인이 보는 것(본인에게만 보이는 답, 대시보드 화면)은 그 사람의 언어.
// 호출부는 언어를 직접 정하지 않고 보낼 곳의 독자에 맞는 함수를 부른다. 언어를 돌려주는 함수(그리기 워커의 일감에 실을 수 있다)와 그 언어의 문구표를 주는 함수가 짝이다

import { MessageFlags } from "discord.js";
import config from "../config/index.ts";
import { BASE_LANGUAGE, TEST_LANGUAGE, acceptedTags, availableLanguages, discordLanguage, matchLanguage, type Language } from "../rules/languages.ts";
import { textFor } from "./text/index.ts";

/** 지금 쓸 수 있는 언어 */
const languagesNow = () => availableLanguages(config.i18n.testLanguage);

/** 봇 기본 언어: 서버 언어도 개인 언어도 정해지지 않았을 때 */
const botLanguage = (): Language => BASE_LANGUAGE;

/** 테스트 언어가 적용되는 서버. GUILD_ID(명령을 그 서버에만 배포할 때 쓰는 테스트 서버의 ID)가 있으면 그 서버만, 없으면 모든 서버 */
const testsIn = (guildId: string) => config.i18n.testLanguage && (config.discord.guildId === null || config.discord.guildId === guildId);

/** 서버 언어. 서버 언어 설정이 없으므로 봇 기본 언어이고, 테스트 언어가 적용되는 서버는 테스트 언어다. 서버 정보가 없으면(guildId 없음) 봇 기본 언어 */
const guildLanguage = (guildId: string | null | undefined): Language => (guildId && testsIn(guildId) ? TEST_LANGUAGE : botLanguage());

/** 상호작용에서 언어를 고르는 데 쓰는 것 */
type Asker = { locale?: string | null; guildId: string | null; message?: { flags: { has(flag: MessageFlags): boolean } } | null };

/** 개인(디스코드 사용자)의 언어: 디스코드 앱 언어(지원하는 언어일 때) → 서버 언어(서버에서 쓴 것일 때) → 봇 기본 언어 */
function personLanguage(asker: Asker): Language {
  return discordLanguage(asker.locale, languagesNow()) ?? (asker.guildId ? guildLanguage(asker.guildId) : botLanguage());
}

/** 기존 메시지를 수정할 때: 그 메시지가 본인에게만 보이는 것이면 개인, 아니면 서버. 메시지가 없는 상호작용(명령, 명령에서 연 모달)은 개인 */
function audienceLanguage(asker: Asker): Language {
  const shared = asker.message && !asker.message.flags.has(MessageFlags.Ephemeral);
  return shared && asker.guildId ? guildLanguage(asker.guildId) : personLanguage(asker);
}

/** 대시보드를 보는 사람의 언어: Accept-Language(브라우저 언어 목록) → 봇 기본 언어 */
function viewerLanguage({ acceptLanguage }: { userId?: string | null; acceptLanguage?: string | null }): Language {
  return matchLanguage(acceptedTags(acceptLanguage), languagesNow()) ?? botLanguage();
}

/** 서버의 공개 메시지에 쓸 문구표 */
const publicText = (guildId: string | null | undefined) => textFor(guildLanguage(guildId));
/** 본인에게만 보이는 답에 쓸 문구표 */
const privateText = (asker: Asker) => textFor(personLanguage(asker));
/** 기존 메시지를 수정할 때 쓸 문구표 */
const audienceText = (asker: Asker) => textFor(audienceLanguage(asker));

export { botLanguage, guildLanguage, personLanguage, audienceLanguage, viewerLanguage, publicText, privateText, audienceText, languagesNow };
export type { Asker };
