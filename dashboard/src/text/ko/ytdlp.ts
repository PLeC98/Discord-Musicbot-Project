// 운영자 패널 업데이트 탭: yt-dlp 카드(설치된 버전, 채널, 자동 업데이트, 확인과 업데이트, 버전 고정)

const title = "yt-dlp";
const releases = "버전 목록";
const installed = "설치된 버전";
const noVersion = "없음";
const downloading = (v: string) => `${v} 다운로드 중…`;
/** target: 다운로드하려던 버전(최신 조회부터 실패했으면 null) */
const failed = (target: string | null, why: string) => `${target ? `${target} 버전을` : "새 버전을"} 다운로드하지 못했어요: ${why}`;
const retryAt = (when: string) => `${when}에 다시 시도해요.`;
const nextCheck = (when: string) => `다음 확인: ${when}`;

const channel = "채널";
const channelHelp = "nightly는 매일, master는 변경이 있을 때마다, stable은 한 달에 한 번쯤 새 버전이 나와요. yt-dlp는 nightly를 권장해요.";
const channelPinned = "버전을 고정한 상태에서는 채널을 바꿀 수 없어요.";
const mode = "자동 업데이트";
const modes = { auto: "자동", notify: "알림", manual: "끄기" };
const modeHelp = "하루에 한 번 실행돼요.";
const modePinned = "버전을 고정한 상태에서는 실행되지 않아요.";

const check = "업데이트 확인";
const checking = "확인 중…";
const update = (v: string) => `업데이트 (${v})`;
const latest = "최신 버전이에요";
/** 설치된 버전 칸의 메뉴(이전 버전이 있을 때) */
const previousMenu = (v: string) => `이전 버전(${v})`;
const rollbackItem = "되돌리기";
const forgetItem = "삭제";
const forgetTitle = "이전 버전을 삭제할까요?";
const forgetBody = (v: string) => `삭제하면 ${v} 버전으로 되돌릴 수 없어요.`;
const forgetConfirm = "삭제";
const forgotten = (v: string) => `이전 버전(${v})을 삭제했어요.`;
const rollbackTitle = "이전 버전으로 되돌릴까요?";
const rollbackBody = (v: string) => `${v} 버전으로 되돌리고 고정해요. 고정을 해제하기 전까지 자동으로 업데이트하지 않아요.`;
const rollbackConfirm = "되돌리기";

const pin = "버전 고정";
const pinHelp = "버전을 고정하면 업데이트 확인과 자동 업데이트가 비활성화돼요.";
const pinPlaceholder = "예: 2026.08.19";
const pinApply = "고정";
const pinRetry = "다시 시도";
const unpin = "해제";
/** days: 고정한 버전이 나온 지 며칠 */
const pinnedAge = (v: string, days: number) => `고정한 버전(${v})은 나온 지 ${days}일 됐어요.`;

const loadFailed = "yt-dlp 상태를 불러오지 못했어요.";
const checkFailed = "업데이트를 확인하지 못했어요.";
const updateFailed = "업데이트를 시작하지 못했어요.";
const saveFailed = "yt-dlp 설정을 저장하지 못했어요.";
const forgetFailed = "이전 버전을 삭제하지 못했어요.";
const updated = "yt-dlp 버전을 바꿨어요";
/** 자동 업데이트가 알림일 때 띄우는 새 버전 알림 */
const available = "yt-dlp에 새 버전이 있어요";
/** 채널은 따로 한 줄(버전 줄 끝에 붙이면 넓은 숫자에서 채널만 다음 줄로 떨어진다). 업데이트하는 곳은 알림의 버튼이 안내한다 */
const availableBody = (from: string, to: string, channel: string) => `${from} → ${to}\n${channel} 채널`;
const availableAction = "업데이트 탭으로";
const downloadFailed = "yt-dlp를 다운로드하지 못했어요.";

export {
  title,
  releases,
  installed,
  noVersion,
  downloading,
  failed,
  retryAt,
  nextCheck,
  channel,
  channelHelp,
  channelPinned,
  mode,
  modes,
  modeHelp,
  modePinned,
  check,
  checking,
  update,
  latest,
  previousMenu,
  rollbackItem,
  forgetItem,
  forgetTitle,
  forgetBody,
  forgetConfirm,
  forgotten,
  rollbackTitle,
  rollbackBody,
  rollbackConfirm,
  pin,
  pinHelp,
  pinPlaceholder,
  pinApply,
  pinRetry,
  unpin,
  pinnedAge,
  loadFailed,
  checkFailed,
  updateFailed,
  saveFailed,
  forgetFailed,
  updated,
  available,
  availableBody,
  availableAction,
  downloadFailed,
};
