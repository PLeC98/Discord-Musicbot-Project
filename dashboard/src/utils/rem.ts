// rem을 px로. 재서 얻은 px(요소 크기, 화면 위치)와 비교할 때 쓴다.
// 브라우저 기본 글자 크기를 키우면 rem이 커지므로, 기준도 rem으로 적고 쓸 때 바꾼다

/** n rem을 px로(지금 1rem이 몇 px 인가를 그때 잰다) */
export const rem = (n: number) => n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
