// 운영자 패널: 디스플레이 탭의 파비콘 카드 · 이미지 편집 · 크기별 팝업(업로드 · 링크 · 기록)

import { josa } from "../../../../src/rules/josa.ts";
import { formatClock, formatDate } from "../../utils/locale.ts";

const favicon = "파비콘";
const faviconDesc = "브라우저 탭과 홈 화면에 보이는 아이콘이에요.";
const faviconTip = "비어 있는 크기는 가까운 크기의 이미지를, 하나도 없으면 봇 프로필을 써요.";
/** 크기마다 쓰이는 곳 */
const useOf = (size: number) => (size <= 48 ? "브라우저 탭" : size === 180 ? "iOS 홈 화면" : "앱 아이콘");
const upload = "추가하기";
const replace = "변경";
const clearOne = (size: number) => `${size}px 파비콘 이미지 삭제(기록은 남아요)`;

/** 이 크기에 내는 것이 어디서 왔는지 */
const from = {
  upload: "올린 이미지",
  scaled: (source: number) => `${source}px 이미지에서`,
  avatar: "봇 프로필",
  none: "없음",
};
/** 이 크기보다 작은 이미지를 늘려 쓸 때 */
const blurryTip = "이 크기보다 작은 이미지를 늘려서 흐릴 수 있어요.";

/** 올리기 전에 거른 까닭(화면이 미리 본다). name 은 파일 이름 */
const refuse = {
  format: (name: string) => `${name}: 이 형식은 올릴 수 없어요.`,
  tooBig: (name: string, max: string) => `${name}: ${max} 보다 큰 파일은 올릴 수 없어요.`,
  tooSmall: (name: string, min: number) => `${name}: ${min}px 보다 작은 이미지는 쓸 수 없어요.`,
  unreadable: (name: string) => `${name}: 이미지를 읽지 못했어요.`,
};
const refusedTitle = "추가하지 않았어요";
const uploadFailed = (name: string) => `${name}${josa(name, "을")} 추가하지 못했어요.`;
const uploaded = (size: number) => `${size}px 파비콘 이미지를 적용했어요`;
const cleared = (size: number) => `${size}px 파비콘 이미지를 삭제했어요`;
const clearFailed = (size: number) => `${size}px 파비콘 이미지를 삭제하지 못했어요.`;
const loadFailed = "파비콘 상태를 읽지 못했어요.";

/** 이미지 편집 대화상자 */
const crop = {
  title: "이미지 편집하기",
  reset: "재설정",
  picked: (width: number, height: number) => `선택한 영역 ${width} × ${height}`,
  /** 선택한 영역이 쓸 크기보다 작을 때만 */
  tooSmall: (target: number) => `${target}px 보다 작아서 흐릴 수 있어요`,
  use: "적용하기",
};

/** 크기별 팝업: 이미지 업로드 · 링크로 추가 · 기록 */
const slotDialog = {
  title: (size: number) => `${size}px 파비콘`,
  /** 업로드 · 링크로 추가 위에 한 줄(상한은 MB 로 나눠 떨어진다) */
  maxSize: (bytes: number) => `최대 파일 크기는 ${bytes / 1024 / 1024}MB예요.`,
  fromFile: "이미지 업로드",
  fromFileHint: "png · webp · jpg · svg",
  fromLink: "링크로 추가",
  linkLabel: "이미지 주소",
  linkPlaceholder: "https://…",
  linkFetch: "가져오기",
  linkBad: "http · https 로 시작하는 주소를 넣어 주세요.",
  linkFailed: "링크에서 이미지를 가져오지 못했어요.",
};

/** 크기마다의 기록(최근 FAVICON_HISTORY 개, 크기별 팝업 안) */
const history = {
  title: "기록",
  desc: (max: number) => `최근 업로드한 파비콘 ${max}개를 불러와 사용할 수 있어요.`,
  /** 업로드한 때 */
  meta: (at: number) => `${formatDate(at, { month: "long", day: "numeric" })} ${formatClock(at)} 업로드`,
  /** 크기 칸에 보이는 기록 개수 */
  count: (n: number) => `기록 ${n}개`,
  inUse: "사용 중",
  removeOne: "기록에서 삭제",
  used: (size: number) => `${size}px 파비콘 이미지를 적용했어요`,
  useFailed: (size: number) => `${size}px 파비콘 이미지를 바꾸지 못했어요.`,
  removed: (size: number) => `${size}px 파비콘 기록에서 이미지를 삭제했어요`,
  removeFailed: (size: number) => `${size}px 파비콘 기록에서 이미지를 삭제하지 못했어요.`,
};

export { favicon, faviconDesc, faviconTip, useOf, upload, replace, clearOne, from, blurryTip, refuse, refusedTitle, uploadFailed, uploaded, cleared, clearFailed, loadFailed, crop, slotDialog, history };
