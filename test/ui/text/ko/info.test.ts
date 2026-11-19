// src/ui/text/ko/info.ts: 정보 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as info from "../../../../src/ui/text/ko/info.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [
      info.refresh(),
      info.cache({ sizeBar: "S", size: "1 GB", maxSize: "2 GB", countBar: "C", files: 3, maxFiles: 9, diskFree: "5 GB", minFreeDisk: "1 GB", plays: 1234, played: "2시간 3분", averageLength: "4분 5초", neverPlayed: 1, platforms: { youtube: 1, soundcloud: 2, direct: 3 }, lookups: 4, downloading: 0, protectedCount: 1 }),
      info.cache({ sizeBar: "S", size: "1 GB", maxSize: "2 GB", countBar: "C", files: 3, maxFiles: 9, diskFree: null, minFreeDisk: "1 GB", plays: 0, played: "0분", averageLength: "0분 0초", neverPlayed: 0, platforms: { youtube: 0, soundcloud: 0, direct: 0 }, lookups: 0, downloading: 0, protectedCount: 0 }).overview,
      info.cacheBlank(),
      info.hours(120),
      info.topLine(1, "곡", 5, "3:00"),
      info.recentLine("곡", "9월 30일"),
      { ...info.ping(), average: info.ping().average(15) },
      info.pinging(),
      info.license(["• a", "• b"]),
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
        title: "📦 오디오 캐시 현황",
        overview: { name: "💿 캐시 현황", value: "**용량:** S\n`1 GB` / `2 GB`\n**파일 수:** C\n`3개` / `9개`\n**디스크 여유:** 5 GB 여유 (최소 1 GB)" },
        plays: { name: "📊 재생 통계", value: "**총 재생 횟수:** 1,234회\n**총 재생 시간:** 2시간 3분\n**평균 곡 길이:** 4분 5초\n**한 번도 안 튼 곡:** 1개" },
        platforms: { name: "🌐 플랫폼 분포", value: "🔴 YouTube: **1**개\n🟠 SoundCloud: **2**개\n🔗 직접 링크: **3**개" },
        misc: { name: "🔧 기타", value: "**링크 데이터:** 4개\n**다운로드 중:** 0개\n**재생 보호 중:** 1개" },
        top: "🏆 재생 TOP 5",
        recent: "🆕 최근 추가",
        footer: "캐시 경로: audio_cache/",
      },
      { name: "💿 캐시 현황", value: "**용량:** S\n`1 GB` / `2 GB`\n**파일 수:** C\n`3개` / `9개`\n**디스크 여유:** 측정 불가 (최소 1 GB)" },
      { noData: "데이터 없음", untitled: "제목 없음", unknownDate: "알 수 없음" },
      "120시간",
      "`1.` **곡**: 5회 (3:00)",
      "**곡** (9월 30일)",
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
        title: "📜 라이선스 정보",
        description: "이 봇은 오픈 소스 소프트웨어입니다.\n네트워크를 통해 이 봇과 상호작용하는 모든 사용자는 GNU AGPL-3.0에 따라 소스 코드를 받을 권리가 있습니다.",
        license: { name: "⚖️ 라이선스", value: "• a\n• b" },
        summary: { name: "📑 라이선스 요약", value: "• 라이선스가 부여된 저작물 및 수정본(라이선스가 부여된 저작물을 활용한 더 큰 규모의 저작물 포함)의 전체 소스 코드를 동일한 AGPL-3.0 라이선스 하에 공개하는 것을 조건으로 합니다.\n• 저작권 및 라이선스 고지는 반드시 유지되어야 합니다.\n• 기여자는 특허 사용권을 명시적으로 허락합니다.\n• 수정된 버전을 사용하여 네트워크를 통해 서비스를 제공하는 경우, 해당 수정된 버전의 전체 소스 코드를 공개해야만 합니다." },
        fullText: { name: "📚 라이선스 전문", value: "저장소의 `LICENSE`(AGPL-3.0) / `LICENSE-MIT`(MIT) / `NOTICE.md`(구조 설명) 파일을 참조하세요." },
        footer: "GNU AGPL-3.0-or-later • MIT",
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
