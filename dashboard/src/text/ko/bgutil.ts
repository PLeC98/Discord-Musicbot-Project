// 운영자 패널 업데이트 탭의 bgutil(POToken 공급자) 카드와, 다시 시작 창의 bgutil 설치 물음

import type { BgutilNeed } from "../../../../src/sources/bgutil/status-types.ts";

const title = "POToken 서버(bgutil)";
const installed = "설치된 버전";
const notInstalled = "설치되지 않음";
/** 설치된 것과 이 봇이 쓰는 것이 다를 때(그사이 설치) */
const serving = (tag: string) => `지금 쓰는 버전 ${tag}`;
const use = "POToken 서버 사용";
const on = "켜짐";
const off = "꺼짐";
const installing = "설치하는 중이에요…";
const queued = "다른 작업이 끝나면 설치해요.";
const reserved = "설치가 끝나면 봇을 다시 시작해요.";
const unreserve = "예약 취소";
const restartToApply = "봇을 다시 시작해야 적용돼요.";
const restart = "다시 시작";
const installThenRestart = "설치 후 다시 시작";
const retry = "재시도";
const failed = (reason: string) => `설치하지 못했어요: ${reason}`;
const missingTitle = "설치에 필요한 프로그램이 없어요.";
/** 없는 것마다 한 줄. 프로그램은 설치 주소를 함께 보인다 */
const needs: Record<BgutilNeed, { label: string; url?: string }> = {
  git: { label: "git", url: "https://git-scm.com/downloads" },
  npm: { label: "npm", url: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm" },
  folder: { label: "vendor/bgutil 폴더에 쓸 수 없어요. 폴더 권한을 확인해 주세요." },
};
const missingAfter = "설치한 뒤 재시도해 주세요.";
const loadFailed = "bgutil 상태를 불러오지 못했어요.";
const retryFailed = "bgutil 설치를 시작하지 못했어요.";
const unreserveFailed = "예약을 취소하지 못했어요.";

/** 다시 시작 창의 bgutil 물음(POToken 서버 사용을 켰는데 설치돼 있지 않다) */
const dialog = {
  installTitle: "bgutil을 설치하고 다시 시작할까요?",
  installBody: "POToken 서버를 쓰려면 bgutil이 있어야 해요. 지금 설치하는 중이고, 끝나면 봇을 다시 시작해요(보통 1분 안팎).",
  installConfirm: "설치 후 다시 시작",
  cannotTitle: "bgutil을 설치할 수 없어요",
  cannotBody: "업데이트 탭의 bgutil 카드에서 재시도할 수 있어요. 지금 다시 시작하면 POToken 없이 켜져요.",
  cannotConfirm: "그래도 다시 시작",
};

export { title, installed, notInstalled, serving, use, on, off, installing, queued, reserved, unreserve, restartToApply, restart, installThenRestart, retry, failed, missingTitle, needs, missingAfter, loadFailed, retryFailed, unreserveFailed, dialog };
