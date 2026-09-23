"use strict";

// 저장소를 임시 폴더의 DB 로 연다. 운영 DB 와 audio_cache 를 건드리지 않는다.
//
//   const store = openTempStore("guild-");
//   after(() => store.close());

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const audioCache = require("../../src/store/audioCache");

function openTempStore(prefix = "store-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  audioCache._cacheDir = path.join(dir, "audio_cache");
  audioCache.initialize(path.join(dir, "cache.db"));
  return {
    dir,
    db: () => audioCache.db,
    close() {
      audioCache.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { openTempStore };
