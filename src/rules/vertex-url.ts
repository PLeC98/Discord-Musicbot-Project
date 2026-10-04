// 버텍스 AI 주소. 주소 칸이 없어 리전 · 프로젝트 · 모델로 조립한다.
// 봇이 부를 주소(autoplay/assist)와 대시보드가 보여 주는 주소(프로젝트를 가린 것)가 같은 규칙을 쓴다

type Where = { location?: unknown } | null | undefined;

/** 리전. 비면 global */
const vertexLocation = (one: Where) => String(one?.location || "").trim() || "global";

/** 리전이 global 이면 호스트도 다르다(지역 호스트로 부르면 404 다) */
const vertexHost = (one: Where) => (vertexLocation(one) === "global" ? "aiplatform.googleapis.com" : `${vertexLocation(one)}-aiplatform.googleapis.com`);

/** 프로젝트 · 리전까지의 주소 */
const vertexBase = (one: Where, project: string) => `https://${vertexHost(one)}/v1/projects/${project}/locations/${vertexLocation(one)}`;

/** 생성 요청 주소 */
const vertexChatUrl = (one: Where, project: string, model: string) => `${vertexBase(one, project)}/publishers/google/models/${model}:generateContent`;

export { vertexLocation, vertexHost, vertexBase, vertexChatUrl };
