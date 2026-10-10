// 버텍스 AI 주소. 주소 칸이 없어 리전 · 프로젝트 · 모델로 조립한다.
// 봇이 부를 주소(autoplay/assist)와 대시보드가 보여 주는 주소(프로젝트를 가린 것)가 같은 규칙을 쓴다

type Where = { location?: unknown } | null | undefined;

/** 리전 모양(us-central1 · europe-west4 · global). 설정 검사(config/schema/ai)도 이것으로 본다 */
const VERTEX_LOCATION = /^[a-z0-9-]+$/;

/** 리전. 비면 global */
const vertexLocation = (one: Where) => String(one?.location || "").trim() || "global";

// 리전은 호스트 이름에 들어간다. 글자를 그대로 넣으면 "evil.example#" 같은 값이 요청을 다른 호스트로 보내고 거기에 접근 토큰이 실린다.
// 검사를 지나지 않은 값(손으로 고친 파일 · 입력 중인 화면)도 호스트를 못 바꾸게, 글자는 늘 인코딩해 넣는다(잘못된 값은 주소가 깨져 요청이 나가지 않는다)
const hostPart = (location: string) => encodeURIComponent(location);

/** 리전이 global 이면 호스트도 다르다(지역 호스트로 부르면 404 다) */
const vertexHost = (one: Where) => (vertexLocation(one) === "global" ? "aiplatform.googleapis.com" : `${hostPart(vertexLocation(one))}-aiplatform.googleapis.com`);

/** 프로젝트 · 리전까지의 주소. 경로 칸도 인코딩한다 */
const vertexBase = (one: Where, project: string) => `https://${vertexHost(one)}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(vertexLocation(one))}`;

/** 생성 요청 주소 */
const vertexChatUrl = (one: Where, project: string, model: string) => `${vertexBase(one, project)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

export { VERTEX_LOCATION, vertexLocation, vertexHost, vertexBase, vertexChatUrl };
