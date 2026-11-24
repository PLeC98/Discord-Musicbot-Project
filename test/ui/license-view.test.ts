// src/ui/license-view.ts, src/rules/project-source.ts: /license 화면과 운영 소스 코드가 고친 버전인지의 판정

import { test } from "node:test";
import assert from "node:assert/strict";
import { licenseView } from "../../src/ui/license-view.ts";
import { isModifiedSource } from "../../src/rules/project-source.ts";
import { textOf } from "../helpers/cv2.ts";
import { textFor } from "../../src/ui/text/index.ts";
const KO = textFor("ko");

const PROJECT = "https://github.com/PLeC98/Discord-Musicbot-Project";
const links = (sourceRepo: string) => [...JSON.stringify(licenseView(KO, { sourceRepo, projectRepo: PROJECT }).toJSON()).matchAll(/"label":"([^"]+)"[^}]*?"url":"([^"]+)"/g)].map((m) => [m[1], m[2]]);

test("봇의 라이선스(AGPL-3.0)와 저작권 고지, 서드파티 고지가 있는 파일을 보여 준다", () => {
  const text = textOf({ components: [licenseView(KO, { sourceRepo: PROJECT, projectRepo: PROJECT })] });
  assert.ok(text.includes("**이 봇** `AGPL-3.0-or-later`\n-# Copyright (C) 2026 PLeC"), text);
  assert.ok(text.includes("NOTICE.md, data/NOTICE"));
});

test("SOURCE_REPO_URL 이 본 저장소면 운영 소스 코드 하나, 고친 버전이면 그 주소와 원본 프로젝트. 끝에 AGPL-3.0 전문", () => {
  assert.deepEqual(links(PROJECT), [
    ["운영 소스 코드", PROJECT],
    ["AGPL-3.0 전문", "https://www.gnu.org/licenses/agpl-3.0.html"],
  ]);
  assert.deepEqual(links("https://github.com/someone/fork"), [
    ["운영 소스 코드", "https://github.com/someone/fork"],
    ["원본 프로젝트", PROJECT],
    ["AGPL-3.0 전문", "https://www.gnu.org/licenses/agpl-3.0.html"],
  ]);
});

test("같은 저장소를 적는 흔한 다른 형식(끝의 /, .git, 대소문자, www.)은 고친 버전이 아니다. 주소가 비어 있으면 고친 버전으로 보지 않는다", () => {
  for (const same of [`${PROJECT}/`, `${PROJECT}.git`, PROJECT.toUpperCase(), PROJECT.replace("https://", "https://www.")]) assert.equal(isModifiedSource(same, PROJECT), false, same);
  assert.equal(isModifiedSource("https://github.com/someone/fork", PROJECT), true);
  assert.equal(isModifiedSource("", PROJECT), false);
});
