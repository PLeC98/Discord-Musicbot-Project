// 운영자 패널: 디스플레이 탭의 파비콘 카드

import { josa } from "../../../../src/rules/josa.ts";

const favicon = "파비콘";
const faviconDesc = "브라우저 탭과 홈 화면에 보이는 아이콘이에요.";
const faviconTip = "큰 그림(512px 이상이나 SVG) 하나면 모든 크기를 채워요.\n작은 크기를 따로 그렸다면 그 크기 그림을 더 올려요. 크기마다 꼭 맞는 그림, SVG, 가장 가까운 그림 순으로 써요.\n올린 그림이 없으면 봇 프로필 그림을 써요.";
const removeOne = "이 그림 지우기";
const noUploads = "올린 그림이 없어요. 봇 프로필 그림을 쓰고 있어요.";
const upload = "그림 올리기";
const uploadHint = "png · webp · jpg(정사각형) · svg, 여러 장 · 끌어다 놓기";

/** 크기마다 그 그림이 어디서 왔는지 */
const from = { avatar: "봇 프로필", none: "없음", exact: "맞춤", stretched: "늘림", scaled: (side: number) => `${side}에서` };

/** 올리기 전에 거른 까닭(화면이 미리 본다). name 은 파일 이름 */
const refuse = {
  format: (name: string) => `${name}: 이 형식은 올릴 수 없어요.`,
  tooBig: (name: string, max: string) => `${name}: ${max} 보다 큰 파일은 올릴 수 없어요.`,
  notSquare: (name: string, width: number, height: number) => `${name}: 정사각형 그림만 쓸 수 있어요(${width} × ${height}).`,
  tooSmall: (name: string, min: number) => `${name}: ${min}px 보다 작은 그림은 쓸 수 없어요.`,
  unreadable: (name: string) => `${name}: 그림을 읽지 못했어요.`,
};
const uploadFailed = (name: string) => `${name}${josa(name, "을")} 올리지 못했어요.`;
const refusedTitle = "올리지 않은 그림이 있어요";
const uploaded = (count: number) => (count === 1 ? "파비콘 그림을 올렸어요" : `파비콘 그림 ${count}장을 올렸어요`);
const removed = "파비콘 그림을 지웠어요";
const removeFailed = "파비콘 그림을 지우지 못했어요.";
const loadFailed = "파비콘 상태를 읽지 못했어요.";

export { favicon, faviconDesc, faviconTip, removeOne, noUploads, upload, uploadHint, from, refuse, uploadFailed, refusedTitle, uploaded, removed, removeFailed, loadFailed };
