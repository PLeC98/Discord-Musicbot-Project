import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * 디렉터리의 모듈(.js · .ts, 선언 파일은 빼고)을 하나씩 불러온다(import). 기본 내보내기가 있으면 그것을, 없으면 이름공간을 준다.
 *
 * 파일 하나의 실패가 나머지를 막지 않고, 디렉터리가 없는 것과 파일이 깨진 것을 구분해서 알린다.
 */
async function loadModules(dir: string) {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith(".js") || (file.endsWith(".ts") && !file.endsWith(".d.ts")));
  } catch {
    return { modules: [], failures: [], missing: true };
  }

  const modules: Array<{ file: string; module: unknown }> = [];
  const failures: Array<{ file: string; error: unknown }> = [];
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, file)).href);
      modules.push({ file, module: mod.default ?? mod });
    } catch (error) {
      failures.push({ file, error });
    }
  }
  return { modules, failures, missing: false };
}

const exported = { loadModules };
export default exported;
export { exported as "module.exports" };
