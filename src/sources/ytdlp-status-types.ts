// 업데이트 탭의 yt-dlp 카드에 보내는 상태(대시보드 공유 타입). Node를 부르지 않는다

import type { RuleProblem } from "../rules/rule-problem.ts";

/** 릴리스 채널 */
type YtdlpChannel = "stable" | "nightly" | "master";
/** auto: 하루 한 번 채널의 최신 버전을 다운로드해 교체, notify: 하루 한 번 확인만 하고 새 버전이 있으면 알림(교체는 운영자가 직접), manual: 운영자가 누를 때만 확인 */
type YtdlpMode = "auto" | "notify" | "manual";

/**
 * version: 설치된 버전(없으면 null). pin: 고정한 태그(모드와 상관없이 그 버전으로 맞춘다).
 * seen: 지금 채널에서 마지막으로 본 최신 태그(확인 버튼, 일일 확인. 봇을 켠 뒤 본 적 없으면 null). 업데이트는 이 태그로만 한다.
 * nextAt: 다음 자동 확인이나 재시도 시각(없으면 null). busy: 다운로드 중인 태그.
 * failure: 마지막 다운로드 실패(교체에 성공하면 비운다). reason은 규칙 문제(화면은 사용자 언어로 그린다). lasting이면 같은 태그로는 다시 시도해도 실패한다(서명 불일치, 이 환경의 파일 없음, 실행되지 않음).
 * canRollback: 이전 버전으로 되돌릴 수 있는지(이전 버전이 있고, 그 폴더가 남아 있거나 다운로드했던 채널을 안다)
 */
type YtdlpCardStatus = {
  version: string | null;
  previous: string | null;
  channel: YtdlpChannel;
  mode: YtdlpMode;
  pin: string | null;
  seen: { latest: string; at: number } | null;
  nextAt: number | null;
  busy: string | null;
  failure: { target: string | null; reason: RuleProblem; lasting: boolean; at: number } | null;
  canRollback: boolean;
};

/** 확인의 답. latest: 그 채널의 최신 태그 */
type YtdlpPeek = { channel: YtdlpChannel; latest: string; at: number };

export type { YtdlpChannel, YtdlpMode, YtdlpCardStatus, YtdlpPeek };
