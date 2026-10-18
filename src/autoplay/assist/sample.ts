// 판정 테스트 · 미리보기의 보기 곡. 판정이 달라지는 세 가지를 일부러 선택했다(멀쩡한 곡 · 믹스 · 길이 모름).
// 대시보드도 같은 것을 보인다(계약 contract/admin 의 AI_SAMPLE_CANDIDATES). 그래서 Node 를 부르지 않는다

import type { TestCandidate } from "./types.ts";

const SAMPLE_CANDIDATES: TestCandidate[] = [{ title: "System Of A Down - Toxicity (Official HD Video)", durationSec: 210 }, { title: "Rock Mix 2024 · 1 Hour Best Rock Songs", durationSec: 3600 }, { title: "이름만 아는 곡 (길이를 모르는 후보)" }];

export { SAMPLE_CANDIDATES };
