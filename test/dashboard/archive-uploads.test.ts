// src/dashboard/archive-uploads.ts: 백업 불러오기에 올린 파일은 세션마다 하나만 둔다. 새로 올리면 앞의 것을, 세션이 끝나면 그 세션의 것을 삭제한다
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const archiveUploads = await import("../../src/dashboard/archive-uploads.ts");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "archive-uploads-"));
archiveUploads._useDir(DIR);
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

/** 다 받은 업로드 흉내(.part)를 두고 세션 sid 로 등록한다 */
function uploaded(id: string, sid: string) {
  fs.writeFileSync(path.join(DIR, `archive-${id}.zip.part`), "zip");
  return archiveUploads.adopt(id, sid);
}

const id = (n: number) => String(n).repeat(32);

test("같은 세션이 새로 올리면 앞의 파일을 삭제한다. 다른 세션의 것은 둔다", () => {
  const first = uploaded(id(1), "a");
  const other = uploaded(id(2), "b");
  const second = uploaded(id(3), "a");
  assert.equal(archiveUploads.fileOf(id(1)), null);
  assert.equal(fs.existsSync(first), false);
  assert.equal(archiveUploads.fileOf(id(3)), second);
  assert.equal(archiveUploads.fileOf(id(2)), other);
  archiveUploads.drop(id(2));
  archiveUploads.drop(id(3));
});

test("세션이 끝나면 그 세션의 파일을 삭제한다", () => {
  const mine = uploaded(id(4), "c");
  const theirs = uploaded(id(5), "d");
  archiveUploads.dropSession("c");
  assert.equal(archiveUploads.fileOf(id(4)), null);
  assert.equal(fs.existsSync(mine), false);
  assert.equal(archiveUploads.fileOf(id(5)), theirs);
  archiveUploads.drop(id(5));
});
