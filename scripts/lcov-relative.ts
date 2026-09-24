// lcov.info 의 파일 경로를 저장소 루트 기준 상대 경로로 바꾼다. node:test 는 절대 경로를 적는데,
// codecov 는 저장소 안의 파일과 경로로 맞춰 본다. `pnpm run test:coverage` 가 끝에 부른다.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const FILE = path.join(ROOT, "lcov.info");

const text = fs.readFileSync(FILE, "utf8");
fs.writeFileSync(
  FILE,
  text.replace(/^SF:(.*)$/gm, (_, file: string) => `SF:${path.relative(ROOT, file).split(path.sep).join("/")}`),
);
