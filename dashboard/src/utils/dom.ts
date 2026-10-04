// 화면 요소에서 값을 읽는 도우미

/** 입력 이벤트가 난 칸의 값(input · textarea · select) */
export const valueOf = (event: Event): string => (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
