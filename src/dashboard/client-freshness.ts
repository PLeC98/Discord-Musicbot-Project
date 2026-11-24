// 빌드해 둔 화면이 지금 소스보다 옛것인가. 화면 빌드(dashboard/vite.config.ts)가 화면이 부른 소스 목록과 빌드 시각을
// dist/.build-inputs.json에 남긴다. 그 뒤에 고쳐지거나 사라진 파일이 있으면 옛 빌드다(git은 바꾼 파일의 수정 시각을 그때로 둔다).
// 화면과 무관한 봇 코드만 바뀌면 조용하다. 점으로 시작하는 이름이라 정적 서빙(express.static)이 내주지 않는다

import fs from "node:fs";
import path from "node:path";
import logger from "../infra/log/logger.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
import { L } from "../infra/log/text.ts";
import type { LogText } from "../infra/log/log-text.ts";
const log = logger.child({ category: "dashboard" });

/** 빌드가 남기는 것. files는 저장소 루트에서의 상대 경로(/ 구분) */
type BuildInputs = { builtAt: number; files: string[] };
type Freshness = { state: "fresh" } | { state: "missing" } | { state: "unknown" } | { state: "stale"; changed: string[] };

const BUILD_INPUTS = ".build-inputs.json";

/** 수정 시각(ms). 파일이 없으면 null */
function mtimeOf(file: string) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(L.dashboard.screenSourceTimeReadFailed({ error: messageOf(error) }));
    return null;
  }
}

function readInputs(file: string): BuildInputs | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BuildInputs>;
    return typeof data.builtAt === "number" && Array.isArray(data.files) ? { builtAt: data.builtAt, files: data.files } : null;
  } catch (error) {
    if (codeOf(error) !== "ENOENT") log.warn(L.dashboard.screenBuildInfoReadFailed({ file: BUILD_INPUTS, error: messageOf(error) }));
    return null;
  }
}

/** dist: 빌드한 화면 폴더, root: 저장소 루트 */
function clientFreshness(dist: string, root: string): Freshness {
  if (!fs.existsSync(path.join(dist, "index.html"))) return { state: "missing" };
  const inputs = readInputs(path.join(dist, BUILD_INPUTS));
  if (!inputs) return { state: "unknown" };
  const changed = inputs.files.filter((rel) => {
    const at = mtimeOf(path.join(root, rel));
    return at === null || at > inputs.builtAt;
  });
  return changed.length ? { state: "stale", changed } : { state: "fresh" };
}

const REBUILD = L.dashboard.screenRebuildHint();
const SHOWN = 3;

/** 운영자에게 남길 경고. 새것이면 null */
function freshnessWarning(freshness: Freshness): LogText | null {
  switch (freshness.state) {
    case "fresh":
      return null;
    case "missing":
      return L.dashboard.screenNotBuilt({ rebuild: REBUILD });
    case "unknown":
      return L.dashboard.screenBuildTimeUnknown({ rebuild: REBUILD });
    case "stale": {
      const { changed } = freshness;
      const more = changed.length > SHOWN ? L.dashboard.screenStaleMore({ count: changed.length - SHOWN }) : "";
      return L.dashboard.screenStale({ count: changed.length, files: changed.slice(0, SHOWN).join(", "), more, rebuild: REBUILD });
    }
  }
}

export { BUILD_INPUTS, clientFreshness, freshnessWarning };
export type { BuildInputs, Freshness };
