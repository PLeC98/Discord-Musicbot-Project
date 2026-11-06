// AI 모델 정보(config/ai-models, ai-prices)의 받은 사본을 임시 폴더로 돌린다. 운영 폴더(database/)의 사본을 읽거나 쓰지 않는다.
// profiles 면 테스트용 모델 프로필(test/fixtures/ai-models.json: 테스트가 쓰는 모델만 고른 레지스트리 사본)을 둔다. 가격표는 비어 있다
//
//   const dir = useModelInfo({ profiles: true });

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as models from "../../src/config/ai-models.ts";
import * as prices from "../../src/config/ai-prices.ts";

const FIXTURE = path.join(import.meta.dirname, "..", "fixtures", "ai-models.json");

function useModelInfo({ profiles = false, dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-info-")) } = {}) {
  if (profiles) fs.copyFileSync(FIXTURE, path.join(dir, "ai-models.json"));
  models._setDir(dir);
  prices._setDir(dir);
  return dir;
}

export { useModelInfo };
