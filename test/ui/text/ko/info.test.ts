// locales/ko/bot/info.ts: 정보 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as info from "../../../../locales/ko/bot/info.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      info.refresh(),
      { ...info.ping(), average: info.ping().average(15) },
      info.pinging(),
      info.license(),
      info.nowPlaying().title,
      info.nowPlaying().line("stats", info.nowPlaying().status, "값"),
      info.nowPlayingStatus({ playing: true, paused: false, volume: 80, loop: false }),
      info.nowPlayingStatus({ playing: false, paused: true, volume: 50, loop: "track" }),
      info.nowPlayingStatus({ playing: false, paused: false, volume: 50, loop: "queue" }),
      info.nowPlaying().queued(12, "43:10", false),
      info.nowPlaying().queued(3, "9:00", true),
      info.nowPlaying().autoplayOn("K-POP"),
    ],
    [
      "새로고침",
      {
        title: "🏓 퐁!",
        response: { name: "응답 시간", note: "명령 → 봇 → 응답" },
        rest: { name: "REST 왕복", note: "봇 ↔ 디스코드 API" },
        gateway: { name: "게이트웨이", note: "봇 ↔ 디스코드 연결" },
        voice: { name: "음성", note: "봇 ↔ 이 서버의 음성 연결" },
        average: "15분 평균",
        measuring: "측정 중...",
        again: "다시 재기",
      },
      "핑 측정 중...",
      {
        title: "📜 라이선스",
        body: "이 봇은 오픈 소스예요. 이 봇을 쓰는 사람은 누구나 현재 사용 중인 봇의 소스 코드를 받을 수 있어요. (GNU AGPL-3.0)",
        thisBot: "이 봇",
        thirdParty: "글꼴, 그림, 라이브러리, 데이터의 라이선스는 저장소의 NOTICE.md, data/NOTICE에 있어요",
        runningSource: "운영 소스 코드",
        originalProject: "원본 프로젝트",
        fullText: "AGPL-3.0 전문",
      },
      "🎵 현재 재생 중",
      "-# 📊 **상태** 값",
      "▶️ 재생 중 • 🔊 80%",
      "⏸️ 일시정지 • 🔊 50% • 🔂 한 곡 반복",
      "⏳ 준비 중 • 🔊 50% • 🔁 대기열 반복",
      "12곡 · 43:10",
      "3곡 · 9:00 이상",
      "켜짐 · K-POP",
    ],
  );
});
