// 설정 불러오기(dashboard/settings-archive, login-background/archive, audio-cache-archive)의 거절 이유, 미리 보기의 문제와 경고

import type { RuleParams, RuleSentences } from "../../rule-problem.ts";

// 쿠키 출처 값: 빈 값은 쓰지 않음, file은 직접 입력, 나머지는 브라우저 이름
const cookiesName = (value: unknown) => (value === "" ? "쓰지 않음" : value === "file" ? "쿠키 직접 입력" : String(value));
// 버전 고정 값: 빈 값은 없음
const pinName = (value: unknown) => String(value) || "없음";
// 로그인 배경 하나(이름)
const background = (p: RuleParams) => `"${p.name}"`;

const archive = {
  "archive-full-backup": () => "전체 백업은 불러올 수 없음. 봇을 종료한 채 봇 폴더에 풀어 덮어쓰세요(다음 기동 시 설정 DB를 교체하고 오디오 캐시를 합침)",
  "archive-no-json": (p) => `${p.name}이 없음. 이 봇의 설정 내보내기 파일이 아님`,
  "archive-json-big": (p) => `${p.name}이 너무 큼`,
  "archive-json-bad": (p) => `${p.name}이 JSON이 아님`,
  "archive-json-shape": (p) => `${p.name}이 객체 형식이 아님`,
  "archive-format": (p) => `모르는 형식(format ${p.format}). 이 봇이 읽는 형식은 ${p.expected}`,
  "archive-favicon-big": () => "파비콘 파일이 너무 큼",
  "archive-not-audio": () => "오디오 캐시 번들이 아님",
  "archive-no-rows": (p) => `${p.name}이 없음. 오디오 캐시 내보내기 파일이 아님`,
  "archive-rows-bad": (p) => `${p.name}이 JSON이 아니거나 너무 큼`,
  "archive-rows-shape": (p) => `${p.name}의 형식이 맞지 않음: ${p.at}`,
  "archive-website": (p) => `봇 웹사이트 주소가 바뀌어요: ${p.url}`,
  "archive-website-cleared": () => "봇 웹사이트 주소가 비워져요.",
  "archive-cookies": (p) => `쿠키 출처가 바뀌어요: ${cookiesName(p.from)} → ${cookiesName(p.to)}`,
  "archive-potoken": () => "POToken 사용이 바뀌어요(다시 시작해야 적용돼요)",
  "archive-ytdlp-pin": (p) => `yt-dlp 버전 고정이 바뀌어요: ${pinName(p.from)} → ${pinName(p.to)}(불러오면 바로 그 버전으로 맞춰요)`,
  "archive-bgutil-pin": (p) => `bgutil 버전 고정이 바뀌어요: ${pinName(p.from)} → ${pinName(p.to)}(업데이트 탭의 bgutil 카드에서 설치해요)`,
  "archive-ai-target": (p) => `AI 요청이 가는 곳이 바뀌어요: ${p.target}`,
  "archive-status-links": (p) => `활동 문구에 새 링크가 들어와요: ${p.links}`,
  "archive-prompt-shape": () => "프롬프트가 섹션 목록이 아니에요",
  "archive-not-table": () => "객체 형식이 아니에요",
  "archive-favicon-index": () => "파비콘 목록(index.json)을 읽을 수 없어요",
  "archive-favicon-missing": () => "목록에 있는 이미지 파일이 빠져 있어요",
  "archive-favicon-broken": () => "깨졌거나 크기가 맞지 않는 이미지가 있어요",
  "lbg-still-missing": (p) => `${background(p)}의 정지 이미지(${p.file})가 없어요`,
  "lbg-still-format": (p) => `${background(p)}의 정지 이미지(${p.file})가 그 폭의 WebP가 아니에요`,
  "lbg-list-missing": (p) => `${background(p)}의 ${p.codec} 목록이 없어요`,
  "lbg-list-bad": (p) => `${background(p)}의 ${p.codec} 목록을 쓸 수 없어요`,
  "lbg-rung-missing": (p) => `${background(p)}의 ${p.codec} ${p.rung} 단계 파일이 없어요`,
  "lbg-rung-bad": (p) => `${background(p)}의 ${p.codec} ${p.rung} 단계 목록을 쓸 수 없어요`,
  "lbg-index-big": () => "배경 기록(index.json)이 너무 커요",
  "lbg-index-unreadable": () => "배경 기록(index.json)을 읽을 수 없어요",
  "lbg-index-shape": () => "배경 기록(index.json)이 객체 형식이 아니에요",
  "lbg-unfinished": () => "완성된 배경 형식이 아닌 기록이 있어요",
  "lbg-duplicate": () => "같은 배경이 두 번 적혀 있어요",
  "lbg-unknown-files": (p) => `모르는 파일이 있어요: ${p.files}${Number(p.more) > 0 ? ` 외 ${p.more}개` : ""}`,
  "lbg-no-room": (p) => `저장 공간이 부족해요(압축을 푼 크기 ${p.size}, 남은 공간 ${p.room})`,
  "lbg-replace": (p) => `지금 배경 ${p.count}개를 모두 삭제하고 파일의 배경으로 바꿔요.`,
  "lbg-stop-making": (p) => `만들고 있는 배경 ${p.count}개도 멈추고 삭제해요.`,
  "lbg-none": () => "파일에 배경이 없어 로그인 화면이 봇 프로필 이미지로 돌아가요.",
} satisfies Partial<RuleSentences>;

export { archive };
