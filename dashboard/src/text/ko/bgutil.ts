// 운영자 패널 업데이트 탭의 bgutil(POToken 공급자) 카드와, 다시 시작 창의 bgutil 설치 물음

import type { BgutilNeed } from "../../../../src/sources/bgutil/status-types.ts";

const title = "POToken 서버(bgutil)";
const releases = "버전 목록";
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
/** 버전 고정과 업데이트 확인. 고정하지 않았으면 입력란에 기본 버전을 보인다 */
const pin = "버전 고정";
const pinHelp = "고정할 때 태그가 가리키는 커밋도 함께 저장해요. 나중에 태그가 옮겨져도 저장한 커밋으로 설치해요.";
const pinPlaceholder = (def: string) => `기본값 ${def}`;
const pinApply = "고정";
const unpin = "해제";
const check = "업데이트 확인";
const checking = "확인 중…";
const update = (v: string) => `업데이트 (${v})`;
const latest = "최신 버전이에요";
/** 설치된 것이 설정한 버전(고정, 기본값)과 다르다 */
const differs = (installed: string, target: string) => `설치된 버전(${installed})이 설정한 버전(${target})과 달라요.`;
const install = "설치";
const pinTitle = "bgutil 버전을 고정할까요?";
/** later: POToken 서버 사용이 꺼져 있고 설치된 것이 없어 지금은 설치하지 않는다 */
const pinBody = (tag: string, commit: string, later: boolean) => `${tag} 태그가 가리키는 커밋(${commit.slice(0, 12)})으로 고정${later ? "해요. POToken 서버 사용을 켜면 이 버전을 설치해요." : "하고 설치해요."}`;
const pinConfirm = "고정";
const unpinTitle = "버전 고정을 해제할까요?";
const unpinBody = (def: string, later: boolean) => (later ? `기본 버전(${def})으로 되돌려요.` : `기본 버전(${def})으로 되돌리고 설치해요.`);
const unpinConfirm = "해제";
const checkFailed = "업데이트를 확인하지 못했어요.";
const resolveFailed = "태그를 확인하지 못했어요.";
const pinFailed = "버전 고정을 저장하지 못했어요.";
const loadFailed = "bgutil 상태를 불러오지 못했어요.";
/** 연령 제한 탭: 쿠키 출처를 정했는데 POToken 서버 사용이 꺼져 있다 */
const ageHint = "POToken 서버 사용이 꺼져 있어요. POToken이 없으면 연령 제한 영상을 저화질 영상으로 다운로드해요.";
const ageHintAction = "유튜브 탭으로";
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

export { title, ageHint, ageHintAction, releases, pin, pinHelp, pinPlaceholder, pinApply, unpin, check, checking, update, latest, differs, install, pinTitle, pinBody, pinConfirm, unpinTitle, unpinBody, unpinConfirm, checkFailed, resolveFailed, pinFailed, installed, notInstalled, serving, use, on, off, installing, queued, reserved, unreserve, restartToApply, restart, installThenRestart, retry, failed, missingTitle, needs, missingAfter, loadFailed, retryFailed, unreserveFailed, dialog };
