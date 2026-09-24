// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 받은 음원의 판(audio_version). 같은 주소에서 음원이 바뀐 것을 나중에 알아볼 값이다.
// 받을 때 같은 응답에서 공짜로 나온다. 값을 적기만 하고, 견주는 일(재검증)은 아직 없다.
//
//   유튜브        받은 포맷 주소의 lmt(그 파일의 최종 수정 시각). 유튜브가 스스로 다시 인코딩해도 바뀐다
//   사운드클라우드 음원 주소 경로의 첫 칸(올린 파일의 이름). 없으면 modified_timestamp
//   직접 링크     응답 헤더 ETag · Last-Modified · Content-Length 중 있는 것을 이어 붙인 한 줄
// 모르면 null.

function parseUrl(value) {
  try {
    return typeof value === "string" ? new URL(value) : null;
  } catch {
    return null;
  }
}

/** yt-dlp 가 받을 때 쓴 info.json 에서. 한 포맷을 받으면 그 주소가 url 이다 */
function fromYtDlpInfo(info) {
  if (!info || typeof info !== "object") return null;
  const url = parseUrl(info.url);
  const lmt = url?.searchParams.get("lmt");
  if (lmt) return `lmt:${lmt}`;
  if (info.extractor_key === "Soundcloud" || /soundcloud/i.test(String(info.extractor || ""))) {
    const file = url?.pathname.split("/").filter(Boolean)[0];
    if (file) return `file:${file}`;
    if (info.modified_timestamp) return `modified:${info.modified_timestamp}`;
  }
  return null;
}

/** 직접 링크 GET 응답 헤더에서. 셋 다 빠질 수 있고 하나씩은 우연히 같을 수 있어 있는 것을 모두 쓴다 */
function fromHeaders(headers) {
  if (!headers) return null;
  const parts = [
    ["etag", headers.etag],
    ["modified", headers["last-modified"]],
    ["length", headers["content-length"]],
  ].filter(([, v]) => v != null && v !== "");
  return parts.length ? parts.map(([k, v]) => `${k}=${v}`).join(";") : null;
}

const exported = { fromYtDlpInfo, fromHeaders };
export default exported;
export { exported as "module.exports" };
