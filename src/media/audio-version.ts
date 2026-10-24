// 다운로드한 음원의 버전(audio_version). 같은 주소에서 음원이 바뀐 것을 나중에 알아볼 값이다.
// 다운로드할 때 같은 응답에서 공짜로 나오고, 캐시의 다시 확인(media/source-recheck)이 원본의 지금 값과 견준다.
//
//   유튜브        다운로드한 포맷 주소의 lmt(그 포맷 인코딩의 시각). 편집(자르기 · 오디오 바꾸기)하면 모든 포맷이 바뀌고, 유튜브가 스스로 다시 인코딩해도 바뀐다.
//                 포맷마다 값이 달라 원본의 지금 포맷 중 하나라도 같으면 같은 원본이다
//   사운드클라우드 음원 주소 경로의 첫 세그먼트(올린 음원 파일의 id, 파형 주소의 값과 같다). 없으면 modified_timestamp
//   직접 링크     응답 헤더 ETag · Last-Modified · 전체 크기 중 있는 것을 이어 붙인 한 줄(구간 응답이면 크기는 Content-Range 의 전체)
// 모르면 null.

function parseUrl(value: unknown): URL | null {
  try {
    return typeof value === "string" ? new URL(value) : null;
  } catch {
    return null;
  }
}

/** yt-dlp 가 다운로드할 때 쓴 info.json 에서. 한 포맷을 다운로드하면 그 주소가 url 이다 */
type YtDlpDownloadInfo = { url?: unknown; extractor_key?: unknown; extractor?: unknown; modified_timestamp?: unknown };

function fromYtDlpInfo(info: YtDlpDownloadInfo | null | undefined): string | null {
  if (!info || typeof info !== "object") return null;
  const url = parseUrl(info.url);
  const lmt = url?.searchParams.get("lmt");
  if (lmt) return `lmt:${lmt}`;
  if (info.extractor_key === "Soundcloud" || /soundcloud/i.test(String(info.extractor || ""))) {
    const file = fromSoundCloudUrl(info.url);
    if (file) return file;
    if (info.modified_timestamp) return `modified:${String(info.modified_timestamp)}`;
  }
  return null;
}

/** 사운드클라우드 음원 주소에서(경로의 첫 세그먼트). 재생 주소와 다운로드한 주소가 같은 파일이면 같은 값이다 */
function fromSoundCloudUrl(value: unknown): string | null {
  const file = parseUrl(value)?.pathname.split("/").filter(Boolean)[0];
  return file ? `file:${file}` : null;
}

/** yt-dlp 가 준 포맷 목록에서 주소의 lmt 들(유튜브 원본의 지금 인코딩들) */
function lmtsOf(formats: readonly unknown[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const format of formats ?? []) {
    const lmt = parseUrl((format as { url?: unknown } | null)?.url)?.searchParams.get("lmt");
    if (lmt) out.add(lmt);
  }
  return out;
}

/** yt-dlp 가 준 포맷 목록에서 오디오만 있는 포맷의 길이(주소의 dur, 초). 없으면 null */
function audioDurationOf(formats: readonly unknown[] | null | undefined): number | null {
  for (const format of formats ?? []) {
    const f = format as { url?: unknown; vcodec?: unknown; acodec?: unknown } | null;
    if (!f || f.vcodec !== "none" || !f.acodec || f.acodec === "none") continue;
    const dur = Number(parseUrl(f.url)?.searchParams.get("dur"));
    if (dur > 0) return dur;
  }
  return null;
}

/** 버전 한 줄에서 유튜브 lmt(아니면 null) */
const lmtOf = (version: string | null | undefined) => (version?.startsWith("lmt:") ? version.slice(4) : null);

/** 직접 링크 GET 응답 헤더에서. 셋 다 빠질 수 있고 하나씩은 우연히 같을 수 있어 있는 것을 모두 쓴다 */
type ResponseHeaders = Record<string, unknown>;

function fromHeaders(headers: ResponseHeaders | null | undefined): string | null {
  if (!headers) return null;
  const total = /\/(\d+)\s*$/.exec(String(headers["content-range"] ?? ""))?.[1];
  const parts = [
    ["etag", headers.etag],
    ["modified", headers["last-modified"]],
    ["length", total ?? headers["content-length"]],
  ].filter(([, v]) => v != null && v !== "");
  return parts.length ? parts.map(([k, v]) => `${String(k)}=${String(v)}`).join(";") : null;
}

// 직접 링크 버전 한 줄을 칸으로. 값에 ; 가 없다(ETag 는 따옴표 안의 글자, 날짜는 , 와 : 뿐)
function partsOf(version: string): Record<string, string> {
  return Object.fromEntries(version.split(";").flatMap((part) => (part.includes("=") ? [[part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)]] : [])));
}

/**
 * 직접 링크의 두 버전이 같은 파일인가. 둘 다 가진 값 중 가장 믿을 만한 것 하나로 가린다: ETag > Last-Modified > 전체 크기.
 * 견줄 값이 없으면 null(모름). 크기만 같은 것은 같은 크기로 다시 인코딩한 파일을 놓친다
 */
function sameDirect(a: string, b: string): boolean | null {
  const x = partsOf(a);
  const y = partsOf(b);
  for (const key of ["etag", "modified", "length"]) if (x[key] && y[key]) return x[key] === y[key];
  return null;
}

export { fromYtDlpInfo, fromSoundCloudUrl, fromHeaders, lmtsOf, lmtOf, audioDurationOf, sameDirect };
