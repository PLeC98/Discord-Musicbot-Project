// vendor-updates 워크플로가 갱신할 이슈 번호를 출력한다(src/rules/vendor-updates의 trackedIssue). 선택할 이슈가 없으면 아무것도 출력하지 않는다.
// 표준 입력: gh issue list --state open --json number,title,author,labels의 결과. 인자: 라벨, GitHub App의 slug, 라벨이 없을 때 찾을 제목 접두사(비면 라벨로만)

import "../src/infra/log/choose-at-start.ts"; // 다른 import보다 먼저 로그 언어를 고른다
import fs from "node:fs";
import { trackedIssue, type IssueRow } from "../src/rules/vendor-updates.ts";

const [label = "", appSlug = "", titlePrefix = ""] = process.argv.slice(2);
const issues = JSON.parse(fs.readFileSync(0, "utf8") || "[]") as IssueRow[];
const found = trackedIssue(issues, label, appSlug, titlePrefix);
if (found !== null) console.log(found);
