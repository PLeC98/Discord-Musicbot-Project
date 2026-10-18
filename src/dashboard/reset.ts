// 초기화(운영자 패널 백업 · 초기화 탭의 초기화 카드). 모양은 contract/reset. 줄마다 이미 있는 지우는 함수를 부르고 메모리를 DB 에 맞춘다.
// 계약이 대시보드 층에 있어 usecases 가 아니라 여기 둔다(백업의 settings-archive 와 같다).

import * as audioCache from "../store/audio-cache.ts";
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
  if (parts.includes("external")) {
    sponsorBlock.forget();
    spotify.forgetAnonState();
  }
  const files = parts.includes("files") ? [`캐시 파일 ${result.removed}개 · ${MB(result.freedBytes)}MB 삭제${result.kept ? `(재생 중 · 대기열 앞이거나 삭제하지 못한 ${result.kept}개는 남김)` : ""}`] : [];
  const rows = parts.filter((part) => part !== "files").map((part) => `${PART_NAMES[part]} ${result.cleared[part] ?? 0}행`);
  log.warn({ sub: "admin" }, `대시보드에서 오디오 캐시 초기화: ${[...files, ...rows].join(" · ")}. 실행 ${by}`);
  return result;
}

export { resetAudioCache };
