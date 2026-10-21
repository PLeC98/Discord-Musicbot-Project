// 로그 파일 보기의 모양(/api/admin/logs/files · /api/admin/logs/file · /api/admin/logs/file/download). 봇과 화면이 같이 읽으므로 Node 를 부르지 않는다.
// 줄은 실시간 로그와 같은 칸이고(levels 의 WireFields), 거르기도 실시간 로그와 같다(matchesLog).
// 쪽은 파일 안의 바이트 위치(offset)로 넘긴다. 지금 쓰는 파일은 꽉 차면 이름이 바뀌어 떼어지므로, 파일은 첫 줄의 시각(since)으로 알아본다

import { koMatch } from "../../rules/ko-search.ts";
import type { LevelName, WireFields } from "../../infra/log/levels.ts";

/** 한 쪽에 받는 줄 수 · 그 상한 */
const FILE_PAGE_LINES = 300;
const FILE_PAGE_MAX = 500;
/** 시각으로 갔을 때 그 줄 뒤로 함께 받는 줄 수(그 줄이 쪽의 맨 끝에 붙지 않게) */
const AT_AFTER_LINES = 50;

/** 로그 파일 하나. 줄이 없으면 firstAt · lastAt 은 0 */
type LogFile = {
  name: string;
  size: number;
  modifiedAt: number;
  /** 지금 쓰는 파일 */
  current: boolean;
  firstAt: number;
  lastAt: number;
  lines: number;
  /** 파일에 나온 카테고리 · 태그(거르기 선택지) */
  categories: string[];
  tags: string[];
};
/** 파일 목록. 지금 쓰는 파일이 먼저, 떼어 낸 파일은 최근 것부터. enabled 가 아니면(파일 로그를 껐다) 비어 있다 */
type LogFileList = { enabled: boolean; files: LogFile[] };

/** 파일의 한 줄. offset 은 그 줄이 시작하는 바이트 위치(다음 쪽의 커서) */
type FileLine = WireFields & { offset: number };
/**
 * 한 쪽. name · since 는 읽은 파일(보던 파일이 떼어졌으면 떼어 낸 파일의 이름이 온다). more 는 앞에, later 는 뒤에 줄이 더 있다.
 * matches 는 찾기가 있을 때 거르기를 모두 건 채 파일 전체에서 맞은 줄 수(처음 받는 쪽에만: before · after 없이)
 */
type FilePage = { name: string; since: number; lines: FileLine[]; more: boolean; later: boolean; matches?: number };

/** 거르기. 비운 칸은 거르지 않는다 */
type LogFilter = { levels?: ReadonlySet<LevelName>; category?: string; tag?: string; q?: string };

/** 줄이 거르기에 맞는지. 찾기는 글 · 카테고리 · 하위 카테고리 · 태그에서(한국어 조합 중 글자 · 초성도) */
function matchesLog(line: Pick<WireFields, "level" | "text" | "category" | "sub" | "tags">, filter: LogFilter): boolean {
  if (filter.levels && !filter.levels.has(line.level)) return false;
  if (filter.category && line.category !== filter.category) return false;
  if (filter.tag && !(line.tags ?? []).includes(filter.tag)) return false;
  const q = filter.q?.trim();
  return !q || [line.text, line.category ?? "", line.sub ?? "", ...(line.tags ?? [])].some((one) => koMatch(one, q));
}

export { FILE_PAGE_LINES, FILE_PAGE_MAX, AT_AFTER_LINES, matchesLog };
export type { LogFile, LogFileList, FileLine, FilePage, LogFilter };
