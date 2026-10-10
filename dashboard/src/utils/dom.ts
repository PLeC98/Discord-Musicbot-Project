// 화면 요소에서 값을 읽는 도우미

/** 입력 이벤트가 난 칸의 값(input · textarea · select) */
export const valueOf = (event: Event): string => (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;

/** 입력기가 글자를 짜는 중에 눌린 키(한글을 치다 엔터 · 방향키를 누르면 짜던 글자를 끝내는 키가 먼저 온다). 이때는 칸의 단축 동작을 하지 않는다 */
export const composing = (event: KeyboardEvent): boolean => event.isComposing || event.keyCode === 229;
