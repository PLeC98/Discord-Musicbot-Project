// 바깥 서비스 키(Spotify · Last.fm · ListenBrainz). 대시보드 설정 탭에서 넣고 비밀 표(store/secrets)에 암호화해 둔다.
// 서비스마다 칸 이름. 화면과 봇이 같은 표를 본다(화면도 부르므로 Node 없는 모듈이다)

const SERVICE_KEYS = {
  spotify: ["clientId", "clientSecret"],
  lastfm: ["apiKey"],
  listenbrainz: ["token"],
} as const;

type ServiceId = keyof typeof SERVICE_KEYS;
type ServiceField<S extends ServiceId = ServiceId> = (typeof SERVICE_KEYS)[S][number];

const SERVICE_IDS = Object.keys(SERVICE_KEYS) as ServiceId[];
const isServiceId = (value: unknown): value is ServiceId => typeof value === "string" && Object.hasOwn(SERVICE_KEYS, value);

/** 비밀값 하나의 상태(값은 없다). none: 없음, ok: 저장됨, again: 다시 넣어야 함(SECRETS_KEY 가 바뀜 · 예전 형식 · 망가짐). last4 는 짧은 값이면 없다 */
type SecretView = { state: "none" | "ok" | "again"; last4: string | null; updatedAt: number | null };
/** 바깥 서비스 키. 서비스 → 칸 → 상태 */
type ServiceKeysView = { [S in ServiceId]: { [F in ServiceField<S>]: SecretView } };
/** AI 키의 상태. none: 없음, ok: 지금 주소에 쓸 수 있음, moved: 주소가 바뀌었음, again: 풀 수 없음(키가 바뀜 · 예전 형식 · 망가짐) */
type AiKeyState = "none" | "ok" | "moved" | "again";
/** 연결 시험. missing: 저장된 키가 없다, rejected: 서비스가 키를 거절했다, unreachable: 서비스에 닿지 못했다 */
type KeyCheck = { ok: true } | { ok: false; reason: "missing" | "rejected" | "unreachable" };

/** 비밀 표의 이름 */
const secretName = (service: ServiceId, field: string) => `service.${service}.${field}`;

export { SERVICE_KEYS, SERVICE_IDS, isServiceId, secretName };
export type { ServiceId, ServiceField, SecretView, ServiceKeysView, KeyCheck, AiKeyState };
