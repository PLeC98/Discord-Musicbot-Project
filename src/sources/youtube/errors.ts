// yt-dlp 오류를 가른다(영상 없음 · 연령 제한 · 클라이언트 탓 · 낡은 미디어 주소).

// 오류에서 읽을 글. yt-dlp 오류는 stderr 에, 나머지는 message 에 담긴다
function textOf(error: unknown): string {
  const e = error && typeof error === "object" ? (error as { stderr?: unknown; message?: unknown }) : null;
  const found = e && (e.stderr || e.message);
  return found ? String(found) : String(error || "");
}

/**
 * yt-dlp 오류를 로그에 남길 만큼으로 줄인다.
 *
 * yt-dlp는 안에서 여러 번 재시도하고 그때마다 같은 경고를 stderr에 다시 쓴다. 그대로 부으면
 * 한 번 실패에 같은 줄이 대여섯 개씩 쌓여 그 위의 재생 로그를 덮는다.
 *
 * 겹친 줄만 접고 내용은 지우지 않는다. 원인이 WARNING에, 결과가 ERROR에 나뉘어 적히는 경우가
 * 있어서다(쿠키가 무효 → 연령 확인을 요구받음). 한쪽만 남기면 왜 실패했는지를 잃는다.
 */
function briefError(error: unknown, maxLines = 4) {
  const raw = textOf(error);
  const seen = new Set();
  const lines = [];
  for (const one of String(raw).split(/\r?\n/)) {
    const line = one.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  if (lines.length <= maxLines) return lines.join("\n");
  return `${lines.slice(0, maxLines).join("\n")}\n(외 ${lines.length - maxLines}줄)`;
}

/** yt-dlp 오류가 연령 제한(로그인 필요)인지 판별 */
function isAgeRestrictedError(error: unknown) {
  const msg = textOf(error);
  return /confirm your age|inappropriate for some users/i.test(msg);
}

/**
 * yt-dlp 오류가 "영상 자체가 내려감/삭제/비공개"인지 판별.
 * 캐시된 매핑의 영상이 사라진 경우 재검색으로 보내기 위한 신호.
 *   일시적 네트워크·봇 감지·연령 제한과는 구별(그것들은 재검색 대상 아님).
 */
function isVideoUnavailableError(error: unknown) {
  // 연령 제한을 먼저 뺀다. 쿠키가 무효일 때 yt-dlp 가 내는 "cookies are no longer valid" 가
  // 아래의 "no longer available" 과 한 단어 차이라, 정규식이 넓어지는 순간 살아 있는 영상이
  // 내려간 것으로 분류된다. 자동재생은 그 판정으로 곡을 영구히 버리므로(markDead) 대가가 크다.
  // 옆의 isClientFault·isStaleMediaError 도 같은 가드를 갖고 있다.
  if (isAgeRestrictedError(error)) return false;

  const msg = textOf(error);
  return /video (?:is )?unavailable|no longer available|has been removed|removed by (the )?(uploader|user)|private video|account associated with this video has been terminated|this video is not available|content isn.?t available|violat(?:ing|ion) of youtube/i.test(msg);
}

/**
 * yt-dlp 가 그 클라이언트를 아예 실행하지 않았는가.
 *
 * 쿠키를 붙이면 쓸 수 있는 클라이언트 집합이 바뀐다. 쿠키를 못 받는 것들(visionos·android·
 * tv_simply 등)은 건너뛰어지고, 남은 것이 없으면 "Requested format is not available" 로 끝난다.
 * 그 메시지만 보면 클라이언트가 실패한 것처럼 보이지만 돌아 본 적조차 없다.
 *
 * 어느 클라이언트가 쿠키를 지원하는지는 우리가 표로 들고 있지 않는다. yt-dlp 가 건너뛰면서
 * 이유를 적어 주므로 그것을 읽는다. 표를 박아 두면 유튜브나 yt-dlp 가 바뀔 때 먼저 어긋난다.
 */
function isSkippedClientError(error: unknown) {
  const msg = textOf(error);
  return /Skipping client "[\w-]+"/i.test(msg);
}

/** 이 실패가 클라이언트 탓으로 보이는가 (영상·네트워크 문제와 구별) */
function isClientFault(error: unknown) {
  const msg = textOf(error);
  if (isVideoUnavailableError(error) || isAgeRestrictedError(error)) return false;
  // 실행조차 안 된 것을 실패로 세면 멀쩡한 클라이언트가 제외된다. 연령 제한 영상 몇 편이면
  // 주력 경로가 세션 내내 빠지고, 그때부터 평상시 재생까지 기본값으로 떨어진다.
  if (isSkippedClientError(error)) return false;
  return /requested format is not available|only images are available|no video formats found|PO Token|nsig extraction failed/i.test(msg) || isStaleMediaError(error);
}

/**
 * 포맷 주소를 받아 놓고 내려받다가 막힌 것인가.
 *
 * 유튜브가 발급한 미디어 주소를 그 CDN이 거절하는 일이 간헐적으로 있다. yt-dlp 자신이 같은
 * 주소로 세 번 재시도해도(retries:3) 계속 403인데, 주소를 새로 받으면 풀린다. 주소 자체가
 * 처음부터 거절당한 것이지 통신이 끊긴 게 아니다.
 *
 * 저쪽 사정이고 우리 쪽에 고칠 것이 없다(yt-dlp #17395. 간헐적이고, OS·VPN·쿠키와 무관하며,
 * 실패한 요청에 siu=1 이 붙는다는 관찰이 있다. 2026.08.19 기준 고쳐진 바 없다).
 * 그래서 여기서는 다시 받는 것만 한다.
 */
function isStaleMediaError(error: unknown) {
  const msg = textOf(error);
  if (isVideoUnavailableError(error) || isAgeRestrictedError(error)) return false;
  // "unable to download video data" 만으로는 안 된다. 네트워크 타임아웃도 같은 문구로 온다.
  // 유튜브가 거절한 것(403/429)과 조각이 어긋난 것만 본다.
  return /HTTP Error (?:403|429)|unable to download fragment|fragment .{0,20}not found/i.test(msg);
}

/**
 * yt-dlp 오류에 붙일 이름. 실행하는 곳(ytdlpSpawn)이 실패할 때 한 번 붙인다. 모르면 null.
 * 차례는 위 판별들이 서로를 빼는 차례와 같다(연령 제한 → 영상 없음 → 건너뛴 클라이언트 → 클라이언트 탓 · 주소 어긋남).
 */
function codeOf(error: unknown) {
  if (isAgeRestrictedError(error)) return "age-restricted";
  if (isVideoUnavailableError(error)) return "video-unavailable";
  if (isSkippedClientError(error)) return "skipped-client";
  if (isStaleMediaError(error)) return "stale-media";
  if (isClientFault(error)) return "client-fault";
  return null;
}

function _faultReason(error: unknown) {
  const msg = textOf(error);
  if (/PO Token/i.test(msg)) return "POToken 필요";
  if (/only images are available/i.test(msg)) return "재생 가능한 포맷 없음";
  if (/requested format is not available/i.test(msg)) return "요청한 포맷 없음";
  return "포맷 획득 실패";
}

export { briefError, isAgeRestrictedError, isVideoUnavailableError, isSkippedClientError, isClientFault, isStaleMediaError, codeOf, _faultReason };
