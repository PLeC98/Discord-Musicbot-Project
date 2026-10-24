// 초기화(운영자 패널 백업 · 초기화 탭의 초기화 카드). /api/admin/reset. 봇과 화면이 같이 읽으므로 Node 를 부르지 않는다.
// 휴대폰의 "설정 초기화 · 기기 전체 초기화"처럼 무엇을 삭제하는지로 나눈 줄 다섯. 여러 항목을 되돌릴 수 없이 한꺼번에 삭제하므로 삭제하는 요청(POST · DELETE)은 최근 로그인을 본다.
// 설정이 바뀌는 줄(봇 설정 · 서버별 설정 · 봇 전체)은 바꾸기 전에 설정 스냅샷(before-reset)을 남긴다.
// 봇 전체 초기화는 켜진 채 삭제하지 않는다: 마커로 예약하고 다시 시작해 다음 기동이 DB 를 열기 전에 삭제한다(사람이 누른 것만, 구조 버전 멈춤과 무관).
// 오디오 캐시 초기화에서 선택하는 것은 rules/audio-cache-parts(봇의 캐시 DB 표 나눔과 같은 목록)

import { AUDIO_CACHE_PARTS, AUDIO_CACHE_PARTS_DEFAULT, isAudioCachePart, type AudioCachePart } from "../../rules/audio-cache-parts.ts";

/**
 * audio-cache: 오디오 캐시(확인 창에서 선택한 것) · bot-settings: 봇 설정(운영 조절값 · 장르 · 상태 문구 · AI 설정 · 프롬프트를 기본값으로, 키 · 쿠키를 삭제) ·
 * guild-settings: 모든 서버의 서버별 설정 · display: 파비콘 · 로그인 배경(기록 · 화면 값 · 한도까지) · all: 봇 전체(.env · vendor · 설정 스냅샷 · 명령 전체 백업 · 로그를 뺀 전부)
 */
const RESET_KINDS = ["audio-cache", "bot-settings", "guild-settings", "display", "all"] as const;
type ResetKind = (typeof RESET_KINDS)[number];
const isResetKind = (value: unknown): value is ResetKind => RESET_KINDS.includes(value as ResetKind);

/** 초기화 요청(POST /api/admin/reset). parts 가 비면 nothing-to-save. all 은 봇 이름(ResetOverview.botName)을 그대로 입력해야 받는다 */
type ResetRequest = { kind: "audio-cache"; parts: AudioCachePart[] } | { kind: "bot-settings" | "guild-settings" | "display" } | { kind: "all"; confirmName: string };

/** 예약한 복원: 설정 스냅샷 이름(없으면 null) · 명령 전체 백업의 오디오 캐시 */
type StagedRestore = { snapshot: string | null; audioCache: boolean };

/**
 * 카드가 줄마다 보이는 지금 양(GET /api/admin/reset). 확인 창이 "무엇이 삭제되는지"를 숫자로 보인다.
 * audioCache: 캐시 파일 수 · 크기(cached 만) · 링크 데이터 행 · 재생 확인 결과 · SponsorBlock 구간 · 연령 제한 · 직접 지정한 음원 /
 * botSettings: 저장된 운영 조절값 · 문서 · 비밀값 수(저장된 것이 곧 기본값과 다른 것) / guildSettings: 설정이 있는 서버 수 /
 * display: 올린 파비콘 그림 수(슬롯 · 기록) · 로그인 배경 기록 수(지금 배경 포함)
 */
type ResetOverview = {
  audioCache: { files: number; bytes: number; ledger: number; checks: number; sponsorSegments: number; ageRestricted: number; pins: number };
  botSettings: { tunables: number; documents: number; secrets: number };
  guildSettings: { guilds: number };
  display: { favicons: number; backgrounds: number };
  /** 봇 전체 초기화에서 입력해야 할 이름(대시보드가 보이는 봇 이름과 같다) */
  botName: string;
  /** 실행기(pnpm start)로 켰는가. 봇 전체 초기화가 곧바로 다시 시작해 삭제하는지(true), 다음에 켤 때 삭제하는지(false) 확인 창이 구분한다 */
  launcher: boolean;
  /** 봇 전체 초기화가 예약되어 있다(다음 기동에 삭제한다). 예약 취소는 DELETE /api/admin/reset/staged(예약되어 있지 않으면 reset-not-staged, 답은 이 모양) */
  staged: boolean;
  /** 예약한 복원. 봇 전체 초기화를 누르면 예약 취소하므로 확인 창이 알린다 */
  restore: StagedRestore;
};

/**
 * 초기화의 답. kind 마다 삭제한 것. snapshot 은 바꾸기 전에 남긴 설정 스냅샷 이름(되돌릴 곳).
 * bot-settings 의 restart: 다시 시작해야 적용되는 값이 바뀌었다(화면이 "지금 다시 시작 · 나중에" 창을 연다).
 * all 의 restarting: 곧바로 다시 시작한다(실행기 없이 켰으면 false: 다음에 켤 때 삭제한다), unstaged: 예약 취소한 복원
 */
type ResetDone = { kind: "audio-cache"; removedFiles: number; freedBytes: number; keptFiles: number; cleared: Partial<Record<AudioCachePart, number>> } | { kind: "bot-settings"; snapshot: string; restart: boolean } | { kind: "guild-settings"; snapshot: string; guilds: number } | { kind: "display"; favicons: number; backgrounds: number } | { kind: "all"; snapshot: string; restarting: boolean; unstaged: StagedRestore };

export { RESET_KINDS, AUDIO_CACHE_PARTS, AUDIO_CACHE_PARTS_DEFAULT, isResetKind, isAudioCachePart };
export type { ResetKind, AudioCachePart, ResetRequest, StagedRestore, ResetOverview, ResetDone };
