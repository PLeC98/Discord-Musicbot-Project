// /queue 모자이크의 칸 이미지. 곡의 작은 썸네일(rules/track-art의 small)이나 찾아 둔 파일 태그 이미지를 칸 크기 JPEG으로 다시 인코딩해 기억해 둔다.
// 외부 이미지는 아는 썸네일 서버(ART_HOSTS)에서 https 로만, 가드된 GET(infra/safe-url)으로 받는다. 리다이렉트도 이 서버들 안에서만. 그 밖의 주소는 받지 않고 그 곡은 기본 이미지(음표)로 그린다.
// 받은 바이트는 첫 바이트가 JPEG, PNG, WebP 일 때만 sharp가 선언된 픽셀 상한을 걸고 디코딩해 다시 인코딩하고, 워커의 캔버스는 이렇게 만든 JPEG만 디코딩한다.
// 비율이 칸(16:9)과 다르면(앨범아트 같은 정사각형) 자르지 않고, 같은 이미지를 흐리게 채운 바탕 위 가운데에 놓는다.
// 받거나 디코딩하지 못한 이미지는 RETRY_MS 동안 다시 받지 않는다(페이지를 넘길 때마다 같은 실패를 되풀이하지 않는다).
// 실패마다 debug 한 줄(주소와 원인). 4xx(출처에 썸네일이 없음)가 아닌 실패는 통신, 서버 문제일 수 있어 원인마다 처음 한 번 warn, 다시 만들면 복구 한 줄

import sharp from "sharp";
import * as safeUrl from "../../infra/safe-url.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { artOf } from "../../rules/track-art.ts";
import * as embeddedArt from "../../sources/embedded-art.ts";
import logger from "../../infra/log/logger.ts";
import { repeatingFailure } from "../../infra/repeating-failure.ts";
import { CELL } from "./layout.ts";
import { L } from "../../infra/log/text.ts";
import { logTextError } from "../../infra/log/log-text.ts";
const log = logger.child({ category: "commands" });
const failing = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, L.commands.queueThumbnailLabel());

/** 받는 썸네일 서버: 유튜브, 스포티파이, 사운드클라우드 */
const ART_HOSTS = [/^i\d?\.ytimg\.com$/, /^img\.youtube\.com$/, /^i\.scdn\.co$/, /^mosaic\.scdn\.co$/, /^image-cdn-[a-z0-9-]+\.spotifycdn\.com$/, /^i\d*\.sndcdn\.com$/];
/** 받아도 되는 주소: https의 ART_HOSTS */
const isArtUrl = (url: URL) => url.protocol === "https:" && ART_HOSTS.some((pattern) => pattern.test(url.hostname));
/** 받을 것: 래스터 이미지만, 크기 상한, 시간 한도, 주소(리다이렉트 홉마다). 이 서버들의 썸네일은 640px 안팎이다 */
const ACCEPT: safeUrl.Accept = { contentType: /^\s*image\/(jpeg|png|webp)\s*(;|$)/i, maxBytes: 2 * 1024 * 1024, timeoutMs: 5000, allowUrl: isArtUrl };
/** 디코딩 전에 거는 선언된 픽셀 수 상한(2000×2000) */
const MAX_PIXELS = 4_000_000;
/** 칸 이미지 크기(px), JPEG 품질 */
const SIZE = { width: Math.ceil(CELL.width), height: CELL.height } as const;
const QUALITY = 82;
/** 기억할 이미지 수(하나에 10KB 안팎). 넘으면 오래 안 쓴 것부터 잊는다 */
const KEEP = 300;
/** 실패한 이미지를 다시 받기까지 */
const RETRY_MS = 10 * 60_000;

type Track = { thumbnail?: string | null; audioUrl?: string; isLive?: boolean };
type Kept = { jpeg: Buffer | null; at: number };
type Fetch = (url: string) => Promise<Buffer>;

let fetchImage: Fetch = (url) => safeUrl.getBuffer(url, ACCEPT);
const kept = new Map<string, Kept>();
const making = new Map<string, Promise<Buffer | null>>();

function isArtHost(url: string) {
  try {
    return isArtUrl(new URL(url));
  } catch {
    return false;
  }
}

/** 첫 바이트로 본 형식이 JPEG, PNG, WebP인지. Content-Type이 없는 응답도 isRaster를 지나야 디코딩한다 */
const isRaster = (data: Buffer) => (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) || data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP");

/** 칸 크기 JPEG. 비율이 거의 같으면 그대로 맞추고, 다르면 흐린 바탕 위 가운데에. JPEG, PNG, WebP가 아니면 예외 */
async function bake(data: Buffer): Promise<Buffer> {
  if (!isRaster(data)) throw logTextError(L.commands.notRasterImage());
  const { data: raw, info } = await sharp(data, { limitInputPixels: MAX_PIXELS, pages: 1 }).rotate().flatten().resize(SIZE.width, SIZE.height, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const fitted = { raw: { width: info.width, height: info.height, channels: info.channels } };
  if (SIZE.width - info.width <= 2 && SIZE.height - info.height <= 2) {
    return sharp(raw, fitted).resize(SIZE.width, SIZE.height, { fit: "fill" }).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
  }
  const back = await sharp(raw, fitted).resize(SIZE.width, SIZE.height, { fit: "cover" }).blur(12).modulate({ brightness: 0.6 }).raw().toBuffer();
  return sharp(back, { raw: { width: SIZE.width, height: SIZE.height, channels: info.channels } })
    .composite([{ input: raw, raw: fitted.raw, gravity: "center" }])
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();
}

/** 이 곡의 칸 이미지를 어디서 가져올지: 기억하는 이름과 원본 바이트를 얻는 함수. 가져올 곳이 없으면 null */
function sourceOf(track: Track): { key: string; read: () => Promise<Buffer | null> } | null {
  const url = artOf(track.thumbnail, "small");
  if (url) return isArtHost(url) ? { key: url, read: () => fetchImage(url) } : null;
  const art = embeddedArt.artFor(track);
  return art ? { key: `embedded:${art.fingerprint}`, read: () => embeddedArt.imageOf(art.fingerprint) } : null;
}

/** 4xx 응답(safe-url이 status를 단다): 그 주소에 이미지가 없다 */
const isClientError = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
};

function remember(key: string, jpeg: Buffer | null) {
  kept.delete(key);
  kept.set(key, { jpeg, at: Date.now() });
  if (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
}

async function make(key: string, read: () => Promise<Buffer | null>): Promise<Buffer | null> {
  try {
    const data = await read();
    const jpeg = data ? await bake(data) : null;
    if (jpeg) failing.ok();
    remember(key, jpeg);
    return jpeg;
  } catch (error) {
    log.debug(L.commands.queueThumbnailFailed({ key, error: messageOf(error) }));
    if (!isClientError(error)) failing.fail(messageOf(error));
    remember(key, null);
    return null;
  }
}

/** 곡 하나의 칸 이미지(없거나 실패하면 null). 기억한 것은 바로, 아니면 받아서 만든다. 같은 이미지를 동시에 두 번 받지 않는다 */
function cellImageOf(track: Track): Promise<Buffer | null> {
  const source = sourceOf(track);
  if (!source) return Promise.resolve(null);
  const known = kept.get(source.key);
  if (known && (known.jpeg || Date.now() - known.at < RETRY_MS)) {
    remember(source.key, known.jpeg);
    return Promise.resolve(known.jpeg);
  }
  let pending = making.get(source.key);
  if (!pending) {
    pending = make(source.key, source.read).finally(() => making.delete(source.key));
    making.set(source.key, pending);
  }
  return pending;
}

/** 곡들의 칸 이미지(곡 순서대로) */
const cellImagesOf = (tracks: readonly Track[]) => Promise.all(tracks.map(cellImageOf));

export { cellImagesOf, isArtHost, SIZE };
export const _internals = {
  useFetch(fake: Fetch) {
    fetchImage = fake;
    kept.clear();
    making.clear();
  },
  bake,
};
