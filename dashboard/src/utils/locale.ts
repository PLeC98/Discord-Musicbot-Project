// 화면의 숫자, 시각, 날짜, 상대 시각, 이름 정렬. 형식 로케일은 여기 한 곳에서 정한다(화면 언어를 정할 때 useLocale로 바꾼다).
// 로케일은 반응형 값이라 언어를 바꾸면 이 값을 읽는 화면은 다시 그려지고 computed는 다시 계산된다. Intl 객체는 로케일마다 한 번 만든다.
// 디자인으로 영어 표기를 쓰는 곳(로그인 화면의 잠금 화면 스타일, 봇 정보 탭의 터미널 스타일)은 그 자리에서 "en-US"를 적는다

import { shallowRef } from "vue";

const locale = shallowRef("ko-KR");

/** 형식 로케일을 바꾼다(rules/languages의 locale) */
function useLocale(tag: string): void {
  locale.value = tag;
}

/** 자릿점을 찍은 수 */
const formatNumber = (n: number) => n.toLocaleString(locale.value);

/** 시각. 기본은 24시간제 시:분, seconds면 초까지 */
const formatClock = (at: number | Date, { seconds = false }: { seconds?: boolean } = {}) => new Date(at).toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });

/** 시각을 그 언어의 보통 형식으로(오전, 오후 등) */
const formatTime = (at: number | Date, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleTimeString(locale.value, options);

const formatDate = (at: number | Date, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleDateString(locale.value, options);

/** 날짜와 시각(2026년 10월 11일 07:30) */
const formatDateTime = (at: number | Date) => `${formatDate(at, { year: "numeric", month: "long", day: "numeric" })} ${formatClock(at)}`;

/** 로케일마다 한 번 만드는 Intl 객체 */
function perLocale<T>(make: (tag: string) => T): () => T {
  const made = new Map<string, T>();
  return () => {
    const tag = locale.value;
    let one = made.get(tag);
    if (!one) made.set(tag, (one = make(tag)));
    return one;
  };
}

const relativeFormat = perLocale((tag) => new Intl.RelativeTimeFormat(tag, { numeric: "auto" }));
/** 상대 시각("3분 전", "내일") */
const relativeTime = { format: (value: number, unit: Intl.RelativeTimeFormatUnit) => relativeFormat().format(value, unit) };

/** 이름 정렬(그 언어의 가나다순) */
const collator = perLocale((tag) => new Intl.Collator(tag));
const compareText = (a: string, b: string) => collator().compare(a, b);

export { useLocale, formatNumber, formatClock, formatTime, formatDate, formatDateTime, relativeTime, compareText };
