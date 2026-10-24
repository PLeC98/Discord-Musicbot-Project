// 연령 제한 콘텐츠를 다루는가(운영자 단위). settings.db 의 "age-content" 문서. 기본은 꺼짐이고, 운영자 패널 일반 탭에서 확인을 거쳐 켠다.
// 꺼져 있으면 쿠키를 쓰지 않고 연령 제한 영상을 거절한다. 연령 제한으로 적힌 곡은 캐시가 있어도 틀지 않는다(캐시는 쿠키 없이 튼다).
// 끄더라도 넣어 둔 쿠키는 지우지 않는다(다시 켜면 그대로 쓴다)

import * as documents from "./documents.ts";

/** changedAt: 마지막으로 켜거나 끈 때(ms). 정한 적이 없으면 null */
type AgeContent = { enabled: boolean; changedAt: number | null };

function ageContent(): AgeContent {
  const data = documents.get("age-content") as Partial<AgeContent> | null;
  return { enabled: data?.enabled === true, changedAt: typeof data?.changedAt === "number" ? data.changedAt : null };
}

const ageContentOn = () => ageContent().enabled;

/** 켜거나 끈다. 이미 그 상태면 그대로 둔다(때를 바꾸지 않는다) */
function setAgeContent(enabled: boolean, now = Date.now()): AgeContent {
  const current = ageContent();
  if (current.enabled === enabled) return current;
  const next = { enabled, changedAt: now };
  documents.put("age-content", next, documents.revisionOf("age-content"));
  return next;
}

export { ageContent, ageContentOn, setAgeContent };
export type { AgeContent };
