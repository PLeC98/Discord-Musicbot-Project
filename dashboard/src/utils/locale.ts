// 화면의 숫자 · 시각 · 날짜 · 상대 시각 · 이름 정렬. 언어는 여기 한 곳(LOCALE)에서 정한다(다국어를 들이면 고른 언어로 바꾼다).
// 디자인으로 영어 표기를 쓰는 곳(로그인 화면의 잠금 화면 결 · 봇 정보 탭의 터미널 결)은 그 자리에서 "en-US" 를 적는다

const LOCALE = "ko-KR";

/** 자릿점을 찍은 수 */
const formatNumber = (n: number) => n.toLocaleString(LOCALE);

/** 시각. 기본은 24시간제 시:분, seconds 면 초까지 */
const formatClock = (at: number | Date, { seconds = false }: { seconds?: boolean } = {}) => new Date(at).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });

/** 시각을 그 언어의 보통 꼴로(오전 · 오후 등) */
const formatTime = (at: number | Date, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleTimeString(LOCALE, options);

/** 날짜 */
const formatDate = (at: number | Date, options: Intl.DateTimeFormatOptions) => new Date(at).toLocaleDateString(LOCALE, options);

/** 날짜와 시각(2026년 10월 11일 07:30) */
const formatDateTime = (at: number | Date) => `${formatDate(at, { year: "numeric", month: "long", day: "numeric" })} ${formatClock(at)}`;

/** 상대 시각("3분 전" · "내일") */
const relativeTime = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** 이름 정렬(그 언어의 가나다 차례) */
const collator = new Intl.Collator(LOCALE);
const compareText = (a: string, b: string) => collator.compare(a, b);

export { LOCALE, formatNumber, formatClock, formatTime, formatDate, formatDateTime, relativeTime, compareText };
