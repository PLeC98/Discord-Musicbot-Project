// 설정 폴더를 임시 폴더로 바꾸고 예제 파일(*.example.*)을 제 이름으로 복사해 둔다.
// 사용자의 config/ 내용이나 그 파일이 있는지에 따라 시험의 답이 갈리지 않게 한다.
//
//   useExampleConfig(); // 시험 파일 머리에서, 설정을 읽기 전에
//
// 시험 파일은 저마다 다른 프로세스에서 돌므로 폴더를 되돌리지 않는다. 임시 폴더는 끝나면 지운다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import * as yamlStore from "../../src/config/yaml-store.ts";

const EXAMPLES = path.join(import.meta.dirname, "..", "..", "config");

function useExampleConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-"));
  for (const name of fs.readdirSync(EXAMPLES)) {
    if (name.includes(".example.")) fs.copyFileSync(path.join(EXAMPLES, name), path.join(dir, name.replace(".example.", ".")));
  }
  yamlStore._setConfigDir(dir);
  after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

export { useExampleConfig };
