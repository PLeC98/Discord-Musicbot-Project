// 일어날 수 없는 일(코드의 버그)의 예외. 개발자에게 알리는 글이라 번역하지 않고 기준 언어 그대로 둔다.
// 문구표 밖 한글 지도(test/ui/text/text-outside)가 따로 세어 기준표보다 늘면 막는다(번역을 피하는 길이 되지 않게). 아무 모듈도 부르지 않는다(화면 번들에 닿는 모듈도 이 파일을 쓴다)

/** 일어날 수 없는 일의 예외 */
const bug = (text: string): Error => new Error(text);

export { bug };
