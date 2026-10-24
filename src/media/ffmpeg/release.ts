// BtbN/FFmpeg-Builds 릴리스에서 이 플랫폼이 받을 자산. 설치(scripts/install-ffmpeg)가 쓴다

const VARIANT = "lgpl"; // 오디오만 쓰므로 GPL 전용 코덱(x264/x265)은 불필요

const RELEASES_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download";

/** BtbN 빌드 하나. 자산 이름 조각 · 아카이브 확장자 · 실행 파일 이름 */
type Target = { slug: string; ext: string; bin: string };
/** 선택한 자산 */
type Asset = { assetName: string; sha256: string; version: string; branch: string };

// BtbN이 제공하는 플랫폼만. 키는 `${process.platform}-${process.arch}`.
const TARGETS: Record<string, Target | undefined> = {
  "linux-x64": { slug: "linux64", ext: "tar.xz", bin: "ffmpeg" },
  "linux-arm64": { slug: "linuxarm64", ext: "tar.xz", bin: "ffmpeg" },
  "win32-x64": { slug: "win64", ext: "zip", bin: "ffmpeg.exe" },
  "win32-arm64": { slug: "winarm64", ext: "zip", bin: "ffmpeg.exe" },
};

/**
 * 릴리스의 checksums.sha256에서 이 플랫폼이 쓸 자산을 선택한다.
 *
 * 한 릴리스에는 ffmpeg 브랜치가 여럿 들어 있다(예: 8.1 · 9.0 · N-master). 그중
 * 릴리스 브랜치의 가장 높은 버전을 쓴다. N-master(`ffmpeg-N-126342-…`)는 이름에 브랜치가
 * 없어 제외되고, `-shared-`는 실행에 별도 라이브러리가 필요해 제외한다.
 *
 * 자산 이름을 코드에 박지 않는 이유: 이름에 커밋 해시가 들어가 릴리스마다 달라진다.
 * 태그 하나만 바꾸면 되도록 이름은 릴리스가 알려주는 것을 쓴다.
 * 이 플랫폼용 빌드가 없으면 null.
 */
function resolveAsset(checksumsText: string, key: string): Asset | null {
  const target = TARGETS[key];
  return target ? assetFor(checksumsText, target, key) : null;
}

function assetFor(checksumsText: string, target: Target, key: string): Asset {
  const pattern = new RegExp(`^ffmpeg-(n\\d[^\\s]*?)-${target.slug}-${VARIANT}-(\\d+\\.\\d+)\\.${target.ext.replace(".", "\\.")}$`);

  let best: (Asset & { order: number[] }) | null = null;
  for (const line of checksumsText.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/);
    if (!hash || !name) continue;

    const match = pattern.exec(name);
    if (!match) continue;

    const branch = match[2].split(".").map(Number);
    if (!best || branch[0] > best.order[0] || (branch[0] === best.order[0] && branch[1] > best.order[1])) {
      best = { assetName: name, sha256: hash, version: match[1], branch: match[2], order: branch };
    }
  }

  if (!best) throw new Error(`이 릴리스에 ${key}용 ${VARIANT} 빌드가 없습니다`);
  return { assetName: best.assetName, sha256: best.sha256, version: best.version, branch: best.branch };
}

export { VARIANT, TARGETS, RELEASES_URL, resolveAsset, assetFor };
export type { Target, Asset };
