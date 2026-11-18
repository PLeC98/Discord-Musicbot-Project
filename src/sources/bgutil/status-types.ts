// bgutil(POToken 공급자)의 설치 상태(대시보드 공유 타입). Node를 부르지 않는다

/** 설치에 없는 것. folder: vendor/bgutil을 만들거나 쓸 수 없다 */
type BgutilNeed = "git" | "npm" | "folder";

/**
 * enabled: 저장된 POToken 서버 사용(다시 시작해야 적용된다). running: 지금 POToken 서버가 도는가.
 * installed: 기록의 지금 빌드(없으면 null). serving: 이 봇이 기동 때 읽어 쓰는 빌드(없으면 null).
 * target: 받을 태그와 커밋(설정이 틀렸으면 null이고 targetError에 그 사유). job: 설치 작업이 도는 중이거나 다른 작업 뒤로 미뤄졌다.
 * failure: 마지막 설치 실패(다시 시도하거나 켜기, 목표가 바뀌기 전까지 혼자서 다시 하지 않는다). missing: 설치에 없는 것(확인한 적 없으면 null).
 * restartNeeded: 다시 시작해야 저장한 켜기, 끄기나 새로 설치한 빌드가 적용된다
 */
type BgutilCardStatus = {
  enabled: boolean;
  running: boolean;
  installed: { tag: string; version: string } | null;
  serving: { tag: string; version: string } | null;
  target: { tag: string; commit: string } | null;
  targetError: string | null;
  job: "running" | "queued" | null;
  failure: { reason: string; at: number } | null;
  missing: BgutilNeed[] | null;
  restartNeeded: boolean;
};

export type { BgutilNeed, BgutilCardStatus };
