// 운영자 패널 업데이트 탭의 외부 프로그램 이전 버전 카드: 삭제할 수 있는 이전 버전과 크기, 이전 버전 삭제

import type { OldTool, OldToolKept } from "../../../src/dashboard/contract/old-tools.ts";
import { josa } from "../../../src/rules/josa.ts";

const title = "외부 프로그램 이전 버전";
const name: Record<OldTool, string> = { ytdlp: "yt-dlp", ffmpeg: "ffmpeg", bgutil: "bgutil", legacy: "예전 설치 위치" };
/** 줄의 값. versions: yt-dlp 태그, ffmpeg 빌드 날짜, bgutil 태그(예전 설치 위치는 비었다) */
const line = (versions: string[], size: string) => (versions.length ? `${versions.join(", ")} (${size})` : size);
const nothing = "삭제할 이전 버전이 없어요.";
const removeAll = "모두 삭제";
/** 줄마다 삭제 버튼의 툴팁 */
const removeOne = (tool: string) => `${tool} 이전 버전 삭제`;
const loadFailed = "이전 버전을 불러오지 못했어요.";

/** 남기는 사유 */
const kept: Record<OldToolKept, string> = {
  "in-use": "봇이 쓰고 있어서 남겨요. 봇을 다시 시작한 뒤에 삭제할 수 있어요.",
  starting: "봇이 아직 시작하는 중이라 남겨요.",
  broken: "설치 기록을 읽지 못해서 남겨요.",
  "only-build": "설치된 빌드가 하나뿐이라 남겨요.",
  link: "심볼릭 링크나 정션으로 연결된 폴더라 남겨요.",
  busy: "다른 프로그램이 폴더를 쓰고 있어서 남겨요. 잠시 뒤에 다시 시도해 주세요.",
  failed: "일부를 삭제하지 못했어요.",
};

const confirm = {
  title: "이전 버전을 삭제할까요?",
  /** 삭제할 것 한 줄 */
  line: (tool: string, versions: string[], size: string) => `${tool}${versions.length ? ` ${versions.join(", ")}` : ""} (${size})`,
  total: (size: string) => `합계 ${size}`,
  note: "이전 버전을 삭제하면 지금 버전에 문제가 생겼을 때 되돌릴 수 없어요.",
  button: "삭제",
};

const done = {
  title: "이전 버전을 삭제했어요",
  freed: (size: string) => `저장 공간 ${size}${josa(size, "을")} 확보했어요.`,
  deferred: "yt-dlp 이전 버전은 사용 중이라 다음 정리 때 삭제돼요.",
  none: "삭제한 이전 버전이 없어요",
  failed: "이전 버전을 삭제하지 못했어요.",
};

export { title, name, line, nothing, removeAll, removeOne, loadFailed, kept, confirm, done };
