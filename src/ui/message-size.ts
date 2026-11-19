// 디스코드 메시지의 컴포넌트 크기. 디스코드는 컴포넌트 전체가 10,240바이트를 넘으면 메시지째 거절한다(413).
// 글자 수 상한(텍스트 4000자, 메뉴 항목 100자) 안이어도 한글은 3바이트라 넘칠 수 있어, 큰 화면(/queue, 재생 패널)은 보내기 전에 잰다

/** 컴포넌트 JSON 바이트의 상한. 디스코드가 세는 값은 JSON 바이트보다 작아 JSON으로 이 값 안이면 받는다 */
const COMPONENTS_BYTES_MAX = 10_000;

/** 컴포넌트들(빌더 또는 JSON)의 JSON 바이트 */
const componentsBytes = (...components: Array<{ toJSON(): unknown } | object>) => Buffer.byteLength(JSON.stringify(components.map((one) => ("toJSON" in one && typeof one.toJSON === "function" ? one.toJSON() : one))));

export { COMPONENTS_BYTES_MAX, componentsBytes };
