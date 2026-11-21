// locales/ko/bot/labels.ts: 라벨을 모두 적어 둔다. 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as labels from "../../../../locales/ko/bot/labels.ts";

test("여러 곡을 담은 출처의 이름. 모르면 재생목록", () => {
  assert.deepEqual(["playlist", "album", "artist", "mix", null, undefined].map(labels.collection), ["재생목록", "앨범", "아티스트 인기곡", "재생목록", "재생목록", "재생목록"]);
});

test("곡 수", () => {
  assert.equal(labels.trackCount(12), "12곡");
});

test("곡 제목. 출처가 제목을 주지 않았으면 알 수 없는 곡", () => {
  assert.deepEqual(["곡", null, undefined, ""].map(labels.songTitle), ["곡", "알 수 없는 곡", "알 수 없는 곡", "알 수 없는 곡"]);
});

test("길이를 말로: 일, 시간, 분(0인 단위는 빼고, 다 0이면 0분). /system 업타임, 대시보드 봇 상태 탭, 대기열 합계", () => {
  assert.deepEqual(
    [0, 0.4, 5, 59.9, 65, 3599, 3600, 3725.7, 86399, 86400, 90061, 360000, 400000.5].map((s) => labels.span(s)),
    ["0분", "0분", "0분", "0분", "1분", "59분", "1시간", "1시간 2분", "23시간 59분", "1일", "1일 1시간 1분", "4일 4시간", "4일 15시간 6분"],
  );
  assert.equal(labels.span(86400 + 120), "1일 2분", "0인 단위는 가운데여도 뺀다");
});

test("시작 전 라이브의 길이 자리", () => {
  assert.equal(labels.upcomingLive(), "예정된 라이브");
});

test("곡이 온 곳의 이름: 서비스 이름은 그 표기 그대로, 직접 링크만 말로", () => {
  assert.deepEqual(["direct", "youtube", "lbradio", "mixcloud", null].map(labels.platform), ["직접 링크", "YouTube", "ListenBrainz Radio", "Mixcloud", "-"]);
});
