// 외부 도구(yt-dlp, bgutil, ffmpeg 인코더, 서명 확인)와 IP 위치 DB의 다운로드, 설치, 실행 실패 이유

import { josa } from "../../../src/infra/josa.ts";
import type { RuleSentences } from "../../../src/rules/rule-problem.ts";

const MB = 1024 * 1024;
// 크기 상한. MB로 나누어떨어지면 MB, 아니면 바이트
const size = (bytes: number) => (bytes >= MB && bytes % MB === 0 ? `${bytes / MB}MB` : `${bytes}바이트`);

const tools = {
  "ytdlp-no-asset": (p) => `이 OS, CPU 용 yt-dlp 판이 없음(${p.where})`,
  "ytdlp-stable-only": (p) => `${p.channel} 채널에는 ${p.arch} 판이 없음(운영자 패널 업데이트 탭의 yt-dlp 채널을 stable로 바꾸세요)`,
  "ytdlp-idle": (p) => `${p.sec}초 동안 받은 것이 없어 끊음`,
  "ytdlp-download-failed": (p, cause) => `${p.file} 다운로드 실패: ${cause}`,
  "ytdlp-too-big": (p) => `크기가 ${size(Number(p.bytes))}를 넘음: ${p.file}`,
  "ytdlp-no-sig-file": (p) => `${p.tag}${josa(String(p.tag), "은")} 서명 파일이 없는 옛 릴리스라 받지 않음(서명 없이 받으려면 터미널에서 pnpm run update:ytdlp --pin ${p.tag} --skip-signature)`,
  "ytdlp-asset-not-listed": (p) => `릴리스 ${p.tag}에 ${p.asset} 없음`,
  "ytdlp-sum-mismatch": (p) => `${p.asset} 체크섬 불일치(기대 ${p.want}…, 실제 ${p.got}…)`,
  "ytdlp-tag-not-in-channel": (p) => `이 채널에 ${p.tag} 버전이 없음(다른 채널의 버전이면 운영자 패널 업데이트 탭에서 채널을 바꾸세요)`,
  "ytdlp-no-sums-file": (p) => `${p.tag}${josa(String(p.tag), "은")} 체크섬 목록(${p.file})이 없는 옛 릴리스라 확인할 수 없어 받지 않음`,
  "ytdlp-unzip-failed": (p, cause) => `${p.file} 압축 풀기 실패: ${cause}`,
  "ytdlp-latest-failed": (_p, cause) => `최신 릴리스 조회 실패: ${cause}`,
  "ytdlp-unusable": (_p, cause) => `이 환경에서 실행되지 않음: ${cause}`,
  "ytdlp-kept-check-failed": (p, cause) => `저장된 yt-dlp ${p.target} 확인 실패: ${cause}`,
  "ytdlp-run-failed": (_p, cause) => `다운로드한 yt-dlp 실행 실패: ${cause}`,
  "ytdlp-version-mismatch": (p) => `다운로드한 yt-dlp의 버전이 다름(${p.version})`,
  "ytdlp-busy": (p) => `다른 프로세스${p.pid ? `(PID ${p.pid})` : ""}가 yt-dlp 폴더를 사용 중(${p.sec}초 대기 초과)`,
  "ytdlp-folders-crossed": () => "버전 폴더가 다른 프로세스와 엇갈림",
  "ytdlp-trash-failed": (p) => `기존 버전 폴더를 삭제 대기 폴더로 옮기지 못함(${p.error})`,
  "ytdlp-place-failed": (p) => `스테이징 폴더를 버전 폴더로 옮기지 못함(${p.attempt}회 시도, ${p.error})`,
  "ytdlp-bad-release-tag": (p) => `yt-dlp 릴리스 태그 형식이 아님: ${p.tag}`,
  "github-release-status": (p) => `GitHub 최신 릴리스 조회 ${p.status} (${p.repo})`,
  "github-release-no-tag": (p) => `GitHub 릴리스에 태그가 없음 (${p.repo})`,
  "git-ls-remote-timeout": (p) => `git ls-remote 시간 초과(${p.sec}초)`,
  "git-ls-remote-failed": (p) => `git ls-remote 실패: ${p.detail}`,
  "bgutil-needs-missing": (p) => `설치에 필요한 것이 없음: ${p.tools}`,
  "bgutil-install-cancelled": () => "중단",
  "bgutil-install-failed": (p) => `${p.why}${p.code !== undefined ? `, 종료 코드 ${p.code}` : ""}${p.tail ? `: ${p.tail}` : ""}`,
  "encoder-failed": (p, cause) => `${p.encoder}: ${cause}`,
  "encoder-exit": (p) => `끝난 코드 ${p.code ?? "없음"}`,
  "encoder-none": () => "쓸 수 있는 인코더가 없음",
  "geoip-not-city": (p) => `도시 DB가 아님(${p.type})`,
  "run-timeout": (p) => `${p.sec}초 안에 끝나지 않아 중단`,
  "run-spawn-failed": (p) => `실행하지 못함(${p.code})`,
  "run-signal": (p) => `신호로 끝남(${p.signal})`,
  "run-exit": (p) => `종료 코드 ${p.status}`,
  "pgp-failed": (_p, cause) => `서명 확인 실패: ${cause}`,
  "pgp-truncated": () => "잘린 패킷",
  "pgp-not-packet": () => "패킷 헤더가 아님",
  "pgp-partial-length": () => "부분 길이 패킷",
  "pgp-unknown-length": () => "길이 미정 패킷",
  "pgp-not-key-block": () => "공개 키 블록이 아님",
  "pgp-no-header-end": () => "공개 키 블록에 헤더 끝이 없음",
  "pgp-no-key-packet": () => "공개 키 패킷이 없음",
  "pgp-key-unsupported": (p) => `받지 않는 공개 키(v${p.version}, 알고리즘 ${p.algorithm})`,
  "pgp-fingerprint-mismatch": (p) => `공개 키의 지문이 고정값과 다름(${p.got})`,
  "pgp-empty-subpacket": () => "빈 하위 패킷",
  "pgp-unknown-critical": (p) => `모르는 중요 하위 패킷(${p.type})`,
  "pgp-not-one-signature": () => "서명 패킷 하나가 아님",
  "pgp-signature-unsupported": (p) => `받지 않는 서명(v${p.version}, 형식 ${p.type}, 알고리즘 ${p.algorithm}, 해시 ${p.hash})`,
  "pgp-no-issuer": () => "서명한 키의 지문이 없음",
  "pgp-other-key": (p) => `다른 키가 서명함(${p.issuer})`,
  "pgp-value-too-big": () => "서명 값이 키보다 큼",
  "pgp-mismatch": () => "서명이 맞지 않음",
} satisfies Partial<RuleSentences>;

export { tools };
