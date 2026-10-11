// 운영자 패널: 자동재생 탭(장르 목록 · 장르 편집 · 출처 편집 · 전역 설정)

import { formatNumber } from "../../utils/locale.ts";

// 목록
const listTitle = (count: number, max: number) => `자동재생 (${count}/${max})`;
const addGenre = "장르 추가";
const atMost = (max: number) => `${max}개까지만 둘 수 있어요`;
const desc = "자동재생에 사용할 장르가 곡을 가져올 출처를 설정해요.";
const global = "전역 설정";
const dragToReorder = "끌어서 차례 바꾸기";
const noName = "이름 없음";
const sourceCount = (count: number) => `출처 ${count}`;
const empty = "장르가 없어요. 오른쪽 위 + 로 더해요";
const savedNote = "다음 자동재생부터 반영돼요";

// 장르 편집
const namePlaceholder = "장르 이름";
const removeGenre = "이 장르 삭제";
const sources = "출처";
const sourcesDesc = "가중치가 높은 출처의 곡을 더 자주 뽑으며, 곡을 받아오지 못하는 출처는 건너뛰어요.";
const overrides = "전역 설정 오버라이드";
const minDuration = "최소 길이(초)";
const maxDuration = "최대 길이(초)";
const currentGlobal = (value: number | string) => `현재 전역 값 ${value}`;
const noGlobalLimit = "전역 제한 없음";

// 검사
const problems = {
  noName: "이름이 없어요",
  duplicate: "같은 이름의 장르가 있어요",
  /** 이름이 빈 장르를 검사에 넘길 때 쓰는 이름 */
  unnamed: "이름 없는 장르",
  noGenres: "장르가 하나도 없어요",
  unknownType: (type: string) => `${type}: 모르는 종류예요. 이 봇이 지원하지 않아요.`,
  unusable: (label: string) => `출처: ${label}\n${label} 키가 없어 해당 출처를 사용하지 않아요. 운영자 패널의 API 키 탭에서 넣어 주세요.`,
};

// 출처 편집
const source = {
  weight: "가중치",
  weightTip: "고를 확률. 비우면 1",
  remove: "이 출처 삭제",
  typesLoading: "출처 종류를 불러오는 중이에요.",
  typesFailed: "출처 종류 목록을 받지 못했어요. 새로 고치면 다시 받아요.",
  unknownType: "모르는 종류예요. 이 봇이 지원하지 않아요.",
  unusable: (label: string) => `${label} 키가 없어 해당 출처를 사용하지 않아요. 운영자 패널의 API 키 탭에서 넣어 주세요.`,
  noKey: " (키 없음)",
  listSuggest: "치면 후보가 떠요. 없는 말은 적고 Enter",
  listPlain: "하나씩 적고 Enter",
  deepClose: "상세 설정 접기",
  deepOpen: (count: number) => `상세 설정 ${count}개 펼치기`,
  window: (depth: number) => `곡이 너무 많으면 상위 ${formatNumber(depth)}곡 중에서 골라요.`,
  addPlaceholder: "출처 추가…",
  add: "출처 추가",
  none: "출처가 하나는 있어야 해요.",
};

// 전역 설정
const defaults = {
  desc: "곡 수 설정 외에는 장르별로 오버라이드가 가능해요.",
  prefetch: "대기열에 미리 넣을 곡 수",
  prefetchTip: "전역 설정 전용\n설정한 만큼 자동재생 곡을 준비하여 미리 대기열에 넣어요.",
  ifEmpty: (value: number | string) => `비우면 ${value}`,
  maxTip: "비우면 제한 없음",
  noLimit: "제한 없음",
  blocked: "키워드 검색 차단어",
  blockedTip: "키워드에만 적용되고, 유튜브에서 찾아낸 곡 제목에 키워드가 있으면 그 곡을 제외해요.\n(대소문자 무관, 영문은 단어 단위 · 한글 · 일본어는 포함 여부로 매칭)",
  blockedPlaceholder: "차단할 말을 적고 Enter",
};

export { listTitle, addGenre, atMost, desc, global, dragToReorder, noName, sourceCount, empty, savedNote, namePlaceholder, removeGenre, sources, sourcesDesc, overrides, minDuration, maxDuration, currentGlobal, noGlobalLimit, problems, source, defaults };
