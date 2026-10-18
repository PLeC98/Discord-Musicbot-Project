// 오디오 캐시 초기화에서 선택하는 것. 봇(store/cache-db 의 표 나눔)과 화면(contract/reset)이 같이 쓴다. Node 를 부르지 않는다.
//   files     캐시 파일(오디오 파일과 그 행)
//   ledger    곡 찾기 기록(링크 데이터 · 재생 테스트 결과)
//   external  바깥 서비스 데이터(SponsorBlock 구간 · 연령 제한 · 스포티파이 익명 상태)
//   pins      직접 지정한 음원

const AUDIO_CACHE_PARTS = ["files", "ledger", "external", "pins"] as const;
type AudioCachePart = (typeof AUDIO_CACHE_PARTS)[number];
const isAudioCachePart = (value: unknown): value is AudioCachePart => AUDIO_CACHE_PARTS.includes(value as AudioCachePart);
/** 처음 선택한 것(직접 지정한 음원은 사람이 선택한 것이라 꺼 둔다) */
const AUDIO_CACHE_PARTS_DEFAULT: readonly AudioCachePart[] = ["files", "ledger", "external"];

export { AUDIO_CACHE_PARTS, AUDIO_CACHE_PARTS_DEFAULT, isAudioCachePart };
export type { AudioCachePart };
