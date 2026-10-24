// SponsorBlock 하이라이트 방패(data/discord-icons/skipIcon.svg)를 그리는 쪽이 쓸 모양으로. 디스코드 앱 이모지(ui/icon-images)와 대시보드가 같이 쓴다.
// 원본 글을 받아 경로만 꺼낸다(편집기 속성 · 정의 · 색은 버린다). 아무것도 부르지 않는다(대시보드 화면 빌드)

/**
 * 방패의 긴 변이 머티리얼 기호의 글꼴 칸에서 차지하는 비율. 방패는 자체 여백이 없어 경계 상자로 맞춘다.
 * 디스코드에서 견주어 정한 "타일의 70%" 를 기호 칸 비율(타일의 88%)로 나눈 것
 */
const SHIELD_OF_GLYPH = 0.7 / 0.88;

/** viewBox · 크기 · 경로 d 들. 채우는 색은 그리는 쪽이 정한다(원본은 둘 다 흰색) */
function shieldOf(svg: string) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 1 1";
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path[\s\S]*?\/>/g)].map((m) => /\sd="([^"]+)"/.exec(m[0])?.[1] ?? "").filter(Boolean);
  return { viewBox, width, height, paths };
}

export { SHIELD_OF_GLYPH, shieldOf };
