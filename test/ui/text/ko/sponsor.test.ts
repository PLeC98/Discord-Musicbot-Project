// locales/ko/bot/sponsor.ts, audit.ts: SponsorBlock 구간 이름과 설명, 감사 로그 사유를 모두 적어 둔다. 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as sponsor from "../../../../locales/ko/bot/sponsor.ts";
import * as audit from "../../../../locales/ko/bot/audit.ts";
import { SKIP_CATEGORIES } from "../../../../src/rules/sponsor-categories.ts";

test("구간 이름과 설명. 모르는 id는 이름이 그대로, 설명은 빈 글", () => {
  assert.deepEqual(
    SKIP_CATEGORIES.map((id) => [id, sponsor.category(id), sponsor.description(id)]),
    [
      ["sponsor", "후원이나 협찬 구간", "유료 광고, 유료 협찬과 같은 직접적인 광고 내용을 포함하는 구간"],
      ["selfpromo", "무대가 홍보 구간", '"후원이나 협찬 구간"과 유사하지만, 자발적으로 홍보하는 내용을 포함하는 구간'],
      ["interaction", "상호작용 알림 구간", "좋아요, 구독, 팔로우를 요청하는 구간"],
      ["intro", "인트로/무음 구간", "반복되는 애니메이션이나 정적 프레임과 같은 내용을 포함하는 구간"],
      ["outro", "최종 화면 구간", "최종 화면이나 크레딧 내용을 포함하는 구간"],
      ["preview", "미리보기/요약 구간", "동영상의 뒷부분에서 반복되는 현재 동영상 또는 시리즈의 다른 동영상에 나온 정보를 보여주는 구간"],
      ["hook", "후킹/인사말", "후속 편에 대한 내용이나, 인사말이 있는 구간"],
      ["filler", "잡담/농담", "전반적인 동영상의 주제를 이해하는 데 필요 없는 잡담이나 농담이 포함되는 구간"],
      ["music_offtopic", "음악이 아닌 구간", "뮤직비디오에만 해당하는 구간"],
    ],
  );
  assert.deepEqual([sponsor.category("chapter"), sponsor.description("chapter")], ["chapter", ""]);
});

test("감사 로그 사유", () => {
  assert.equal(audit.deafen(), "쓰지 않는 음성 수신을 끊어 트래픽 절약");
});
