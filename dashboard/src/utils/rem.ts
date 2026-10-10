// rem 을 px 로. 재서 얻은 px(요소 크기 · 화면 자리)와 견줄 때 쓴다.
// 브라우저 기본 글자 크기를 키우면 rem 이 커지므로, 기준도 rem 으로 적고 쓸 때 바꾼다

/** n rem 을 px 로(지금 1rem 이 몇 px 인가를 그때 잰다) */
export const rem = (n: number) => n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
