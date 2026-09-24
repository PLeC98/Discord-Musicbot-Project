"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

/**
 * 디렉터리의 .js를 하나씩 불러온다(import). CommonJS 파일이면 module.exports, ESM 이면 기본 내보내기를 준다.
 *
 * 파일 하나의 실패가 나머지를 막지 않고, 디렉터리가 없는 것과 파일이 깨진 것을 구분해서 알린다.
 * @returns {Promise<{modules: Array<{file: string, module: any}>, failures: Array<{file: string, error: Error}>, missing: boolean}>}
 */
async function loadModules(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith(".js"));
  } catch {
    return { modules: [], failures: [], missing: true };
  }

  const modules = [];
  const failures = [];
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

module.exports = { loadModules };
