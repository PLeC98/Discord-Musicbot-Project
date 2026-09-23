"use strict";

const fs = require("fs");
const path = require("path");

/**
 * 디렉터리의 .js를 하나씩 require한다.
 *
 * 파일 하나의 실패가 나머지를 막지 않고, 디렉터리가 없는 것과 파일이 깨진 것을 구분해서 알린다.
 * @returns {{modules: Array<{file: string, module: any}>, failures: Array<{file: string, error: Error}>, missing: boolean}}
 */
function loadModules(dir) {
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
      modules.push({ file, module: require(path.join(dir, file)) });
    } catch (error) {
      failures.push({ file, error });
    }
  }
  return { modules, failures, missing: false };
}

module.exports = { loadModules };
