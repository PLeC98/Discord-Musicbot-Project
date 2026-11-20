// SponsorBlock 구간 종류(rules/sponsor-categories)의 이름과 설명. 디스코드 /setting, 대시보드 설정 화면과 재생 막대가 같이 쓴다

import { isSkipCategory, type SkipCategory } from "../../../rules/sponsor-categories.ts";

// 이름. SponsorBlock 확장 프로그램의 한국어 번역을 그대로 쓴다(무대가 = 대가 없는)
const NAMES: Readonly<Record<SkipCategory, string>> = {
  music_offtopic: "음악이 아닌 구간",
  intro: "인트로/무음 구간",
  outro: "최종 화면 구간",
  sponsor: "후원이나 협찬 구간",
  selfpromo: "무대가 홍보 구간",
  interaction: "상호작용 알림 구간",
  preview: "미리보기/요약 구간",
  hook: "후킹/인사말",
  filler: "잡담/농담",
};

// 설명. 대시보드 설정 화면이 이름 옆에 표시한다
const DESCRIPTIONS: Readonly<Record<SkipCategory, string>> = {
  music_offtopic: "뮤직비디오에만 해당하는 구간",
  intro: "반복되는 애니메이션이나 정적 프레임과 같은 내용을 포함하는 구간",
  outro: "최종 화면이나 크레딧 내용을 포함하는 구간",
  sponsor: "유료 광고, 유료 협찬과 같은 직접적인 광고 내용을 포함하는 구간",
  selfpromo: '"후원이나 협찬 구간"과 유사하지만, 자발적으로 홍보하는 내용을 포함하는 구간',
  interaction: "좋아요, 구독, 팔로우를 요청하는 구간",
  preview: "동영상의 뒷부분에서 반복되는 현재 동영상 또는 시리즈의 다른 동영상에 나온 정보를 보여주는 구간",
  hook: "후속 편에 대한 내용이나, 인사말이 있는 구간",
  filler: "전반적인 동영상의 주제를 이해하는 데 필요 없는 잡담이나 농담이 포함되는 구간",
};

/** 구간 종류의 이름. 모르는 id면 그대로 */
const category = (id: string) => (isSkipCategory(id) ? NAMES[id] : id);
/** 구간 종류의 설명. 모르는 id면 빈 글 */
const description = (id: string) => (isSkipCategory(id) ? DESCRIPTIONS[id] : "");

export { category, description };
