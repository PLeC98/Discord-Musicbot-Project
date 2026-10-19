// 초기화(운영자 패널 백업 · 초기화 탭의 초기화 카드). 모양은 contract/reset. 줄마다 이미 있는 지우는 함수를 부르고 메모리를 DB 에 맞춘다.
// 설정이 바뀌는 줄(봇 설정 · 서버별 설정)은 바꾸기 전에 설정 스냅샷(before-reset)을 남긴다.
// 계약이 대시보드 층에 있어 usecases 가 아니라 여기 둔다(백업의 settings-archive 와 같다).

import fs from "node:fs";
import path from "node:path";
import * as audioCache from "../store/audio-cache.ts";
import * as embeddedArt from "../sources/embedded-art.ts";
import { settingsDb } from "../store/settings-db.ts";
import { rowCounts } from "../store/cache-db.ts";
import * as fullReset from "../store/full-reset.ts";
import * as settingsDocs from "../store/settings-docs.ts";
import * as secrets from "../store/secrets.ts";
import * as tunables from "../store/tunables.ts";
import * as serviceKeys from "../store/service-keys.ts";
import * as guildSettings from "../store/guild-settings.ts";
import * as snapshots from "../store/snapshots.ts";
import * as documents from "../config/documents.ts";
import * as appearance from "./appearance.ts";
import * as backgroundStore from "./login-background/store.ts";
import * as backgroundRunner from "./login-background/runner.ts";
import { LOGIN_BG_LIMITS_DEFAULT, LOGIN_BG_OPTIONS_DEFAULT } from "./contract/login-background.ts";
import { STAGED_AUDIO } from "./settings-archive.ts";
import type { ResetOverview, StagedRestore } from "./contract/reset.ts";
import * as sponsorBlock from "../sources/sponsor-block.ts";
import * as spotify from "../sources/spotify.ts";
import type { AudioCachePart } from "../rules/audio-cache-parts.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });

const PART_NAMES: Record<AudioCachePart, string> = { files: "캐시 파일", ledger: "곡 찾기 기록", external: "바깥 서비스 데이터", pins: "직접 지정한 음원" };
const MB = (bytes: number) => Math.round(bytes / 1024 / 1024);

/**
 * 오디오 캐시에서 선택한 것을 지운다. 바깥 서비스 데이터면 메모리의 기억(SponsorBlock 구간 · 스포티파이 익명 상태)도 버린다.
 * @param by  로그에 남길 실행한 사람
 */
async function resetAudioCache(parts: readonly AudioCachePart[], by: string) {
  const result = await audioCache.resetCache(parts);
  // 기억한 파일 태그 · 그림은 캐시 파일의 판을 가리킨다
  if (parts.includes("files")) embeddedArt.clear();
  if (parts.includes("external")) {
    sponsorBlock.forget();
    spotify.forgetAnonState();
  }
  const files = parts.includes("files") ? [`캐시 파일 ${result.removed}개 · ${MB(result.freedBytes)}MB 삭제${result.kept ? `(재생 중 · 대기열 앞이거나 삭제하지 못한 ${result.kept}개는 남김)` : ""}`] : [];
  const rows = parts.filter((part) => part !== "files").map((part) => `${PART_NAMES[part]} ${result.cleared[part] ?? 0}행`);
  log.warn({ sub: "admin" }, `대시보드에서 오디오 캐시 초기화: ${[...files, ...rows].join(" · ")}. 실행 ${by}`);
  return result;
}

/**
 * 봇 설정을 기본값으로: 설정 문서(운영 조절값 · 장르 · 상태 문구 · AI 설정 · 프롬프트)와 비밀값(서비스 키 · AI 키 · 쿠키)을 한 트랜잭션에서 삭제한다.
 * 기본값을 써 넣지 않는다(그 버전의 기본값이 굳어 다음 버전의 기본값을 따라가지 않는다). 순서는 가져오기와 같다: 스냅샷 → 한 트랜잭션 → 다시 읽기.
 * restart: 다시 시작해야 적용되는 값이 기동 때 값과 달라졌다
 */
async function resetBotSettings(by: string) {
  const snapshot = await snapshots.take("before-reset");
  const removed = settingsDb.get().transaction(() => ({ documents: settingsDocs.removeAll(), secrets: secrets.removeAll() }))();
  documents.reload();
  tunables.reload();
  serviceKeys.load();
  const restart = tunables.view().pending.length > 0;
  log.warn({ sub: "admin" }, `대시보드에서 봇 설정 초기화: 설정 문서 ${removed.documents}개 · 비밀값 ${removed.secrets}개 삭제(되돌릴 스냅샷 ${snapshot})${restart ? ". 다시 시작해야 적용되는 값이 있습니다" : ""}. 실행 ${by}`);
  return { snapshot, restart };
}

/** 모든 서버의 서버별 설정을 지운다. 바꾸기 전에 스냅샷을 남긴다 */
async function resetGuildSettings(by: string) {
  const guilds = guildSettings.guildCount();
  const snapshot = await snapshots.take("before-reset");
  guildSettings.replaceAll({});
  guildSettings.forgetCache();
  log.warn({ sub: "admin" }, `대시보드에서 서버별 설정 초기화: 서버 ${guilds}곳(되돌릴 스냅샷 ${snapshot}). 실행 ${by}`);
  return { snapshot, guilds };
}

/** 파비콘 · 로그인 배경(기록 · 화면 값 · 한도까지)을 비운다. 로그인 배경은 백업 불러오기와 같은 길(도는 단계를 멈추고 기록을 통째로 바꾼다) */
function resetDisplay(by: string) {
  const favicons = appearance.clearFavicons();
  const backgrounds = backgroundStore.items().length;
  backgroundRunner.stopAll();
  backgroundStore.replace({ current: null, items: [], options: LOGIN_BG_OPTIONS_DEFAULT, limits: LOGIN_BG_LIMITS_DEFAULT });
  log.warn({ sub: "admin" }, `대시보드에서 디스플레이 설정 초기화: 파비콘 ${favicons}개 · 로그인 배경 ${backgrounds}개. 실행 ${by}`);
  return { favicons, backgrounds };
}

// 명령 전체 백업이 풀어 둔 오디오 캐시 번들(열린 설정 DB 의 폴더 안)
const stagedAudioFile = () => path.join(path.dirname(settingsDb.get().name), STAGED_AUDIO);
// 예약한 복원: 설정 스냅샷 · 명령 전체 백업의 오디오 캐시
const stagedRestore = (): StagedRestore => ({ snapshot: snapshots.staged(), audioCache: fs.existsSync(stagedAudioFile()) });

/**
 * 카드가 줄마다 보이는 지금 양
 * @param botName   봇 전체 초기화에서 입력할 이름(대시보드가 보이는 봇 이름)
 * @param launcher  실행기로 켰나(곧바로 다시 시작할 수 있나)
 */
function overview(botName: string, launcher: boolean): ResetOverview {
  const rows = rowCounts();
  const { files, bytes } = audioCache.storageStats().cache;
  return {
    audioCache: { files, bytes, ledger: rows.track_lookup, checks: rows.source_checks, sponsorSegments: rows.sponsorblock_cache, ageRestricted: rows.age_restricted, pins: rows.pinned_sources },
    botSettings: { tunables: Object.keys(tunables.view().values).length, documents: settingsDocs.names().filter((name) => name !== "tunables").length, secrets: secrets.count() },
    guildSettings: { guilds: guildSettings.guildCount() },
    display: { favicons: appearance.faviconCount(), backgrounds: backgroundStore.items().length },
    botName,
    launcher,
    staged: fullReset.requested(),
    restore: stagedRestore(),
  };
}

/**
 * 봇 전체 초기화를 예약한다: 예약한 복원을 취소하고(남기면 초기화한 봇에 옛 설정이 들어온다) 스냅샷을 남긴 뒤 마커를 건다.
 * 지우는 것은 다음 기동(store/full-reset). 곧바로 다시 시작할지는 부르는 쪽(경로)이 정한다
 */
async function stageFullReset(by: string, restarting: boolean) {
  const unstaged = stagedRestore();
  snapshots.unstage();
  fs.rmSync(stagedAudioFile(), { force: true });
  const snapshot = await snapshots.take("before-reset");
  fullReset.request();
  log.warn({ sub: "admin" }, `대시보드에서 봇 전체 초기화를 예약했습니다(${restarting ? "곧바로 다시 시작해 지웁니다" : "다음에 켤 때 지웁니다"}, 되돌릴 스냅샷 ${snapshot}${unstaged.snapshot ? `, 예약한 복원 ${unstaged.snapshot} 은 취소` : ""}${unstaged.audioCache ? ", 오디오 캐시 번들은 삭제" : ""}). 실행 ${by}`);
  return { snapshot, unstaged };
}

/** 봇 전체 초기화 예약을 취소한다. 예약되어 있었으면 true */
function cancelFullReset(by: string): boolean {
  if (!fullReset.cancel()) return false;
  log.warn({ sub: "admin" }, `대시보드에서 봇 전체 초기화 예약을 취소했습니다. 실행 ${by}`);
  return true;
}

export { resetAudioCache, resetBotSettings, resetGuildSettings, resetDisplay, overview, stageFullReset, cancelFullReset };
