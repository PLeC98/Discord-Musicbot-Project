// 판정: 곡의 음원 주소를 어떻게 알았나. 링크 데이터에서 온 음원 · 직접 지정한 음원은 죽었을 때 다시 찾고, 링크 데이터에 쓰는 법도 이것으로 가른다.
//
//   given    요청 그대로(유튜브 · 사운드클라우드 · 직접 링크)
//   ledger   오디오 링크 데이터(track_lookup)에서 온 것, 또는 자동으로 찾아 링크 데이터에 한 번 넣은 것
//   search   지금 검색으로 찾은 것(아직 링크 데이터에 넣지 않았다)
//   pinned   운영자가 캐시 DB 에서 직접 지정한 음원(pinned_sources)

const AUDIO_FOUND_BY = ["given", "ledger", "search", "pinned"] as const;
type AudioFoundBy = (typeof AUDIO_FOUND_BY)[number];

const isAudioFoundBy = (value: unknown): value is AudioFoundBy => AUDIO_FOUND_BY.includes(value as AudioFoundBy);

export { AUDIO_FOUND_BY, isAudioFoundBy };
export type { AudioFoundBy };
