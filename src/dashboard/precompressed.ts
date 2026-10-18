// 빌드한 화면의 압축본. 화면을 빌드할 때 텍스트 파일마다 .br · .gz 를 만들어 두고(dashboard/vite.config.ts 의 precompress),
// 받는 쪽이 받을 수 있으면 원본 대신 그것을 보낸다(요청마다 압축하지 않는다). 압축본이 없거나 받을 수 없으면 다음(express.static)이 원본을 보낸다

import fs from "fs";
import path from "path";
import type { RequestHandler, Response } from "express";

/** 선택하는 순서: brotli 가 더 작다 */
const ENCODINGS = [
  { name: "br", ext: ".br" },
  { name: "gzip", ext: ".gz" },
] as const;

/** Accept-Encoding 에서 받는 방식들(q=0 은 뺀다) */
function acceptedOf(header: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((one) => one.trim()).find((one) => one.startsWith("q="));
    if (name && !(q && Number(q.slice(2)) === 0)) out.add(name);
  }
  return out;
}

/** root: 빌드한 화면 폴더. setHeaders: 원본 파일 기준의 헤더(캐시 규칙, express.static 과 같은 것) */
function precompressed(root: string, setHeaders: (res: Response, file: string) => void): RequestHandler {
  const base = path.resolve(root);
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel: string;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const file = path.resolve(base, `.${rel.endsWith("/") ? `${rel}index.html` : rel}`);
    // 폴더 밖으로 나가는 주소는 다루지 않는다
    if (!file.startsWith(base + path.sep)) return next();
    const accepted = acceptedOf(req.headers["accept-encoding"]);
    for (const { name, ext } of ENCODINGS) {
      if (!accepted.has(name) || !fs.existsSync(file + ext)) continue;
      res.setHeader("Content-Encoding", name);
      res.setHeader("Vary", "Accept-Encoding");
      res.type(path.extname(file));
      setHeaders(res, file);
      return res.sendFile(file + ext, (error) => error && next(error));
    }
    next();
  };
}

export { precompressed };
