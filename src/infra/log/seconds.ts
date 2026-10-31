// 로그에 적는 걸린 시간, 위치. 밀리초를 소수 한 자리 초로(단위는 부르는 쪽 문장에 있다). 모르면 ?

const sec = (ms: number | null | undefined) => (ms == null ? "?" : (ms / 1000).toFixed(1));

export { sec };
