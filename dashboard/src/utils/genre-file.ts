// 장르 하나를 파일로 주고받는 형식. 내보내기는 편집기에 보이는 장르(저장하지 않은 편집 포함)를, 불러오기는 그 파일을 새 행으로 만든다.
// 파일은 { musicbotGenre: 형식 번호, id: 식별자, genre: 장르 문서의 한 항목 그대로 }. 그래서 불러온 뒤에는 편집기, 저장 검사(schema/genres)가 평소처럼 본다

import { toMap, toRows, type GenreData, type GenreRow, type SourceData } from "./genre-rows.ts";

const FORMAT = 1;

/** 받을 파일 이름과 내용 */
function genreFile(row: GenreRow): { name: string; body: string } {
  const id = row.name.trim();
  const genre = toMap([row])[id];
  // 파일 이름에 못 쓰는 글자, 공백은 - 로
  const safe = id.replace(/[\\/:*?"<>|\s]+/g, "-");
  return { name: `genre-${safe || "unnamed"}.json`, body: `${JSON.stringify({ musicbotGenre: FORMAT, id, genre }, null, 2)}\n` };
}

/** 장르 파일이면 식별자와 장르, 아니면 null(JSON 이 아님, 다른 파일, 모르는 형식 번호) */
function parseGenreFile(text: string): { id: string; genre: GenreData } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const file = data as { musicbotGenre?: unknown; id?: unknown; genre?: unknown } | null;
  if (!file || typeof file !== "object" || file.musicbotGenre !== FORMAT || typeof file.id !== "string") return null;
  if (!file.genre || typeof file.genre !== "object" || Array.isArray(file.genre)) return null;
  return { id: file.id.trim(), genre: file.genre as GenreData };
}

/** 겹치지 않는 식별자. 이미 있으면 뒤에 -2, -3 … */
function freeName(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let n = 2; ; n++) if (!taken.has(`${id}-${n}`)) return `${id}-${n}`;
}

/**
 * 이 봇이 모르는 종류의 출처(다른 버전에서 내보낸 파일 등)는 뺀다. 빼지 않으면 그 장르는 저장 검사에 걸려 저장 전체가 막힌다.
 * 아는 종류인데 값이 맞지 않는 것은 남긴다. 편집기가 문제를 보이고, 고치기 전에는 저장되지 않는다(봇 설정에 들어가지 않는다)
 */
function supportedOnly(genre: GenreData, known: ReadonlySet<string>): { genre: GenreData; dropped: string[] } {
  const list: unknown[] = Array.isArray(genre.sources) ? genre.sources : [];
  const dropped: string[] = [];
  const sources = list.filter((one): one is SourceData => {
    const type = one && typeof one === "object" ? (one as SourceData).type : undefined;
    if (typeof type === "string" && known.has(type)) return true;
    dropped.push(typeof type === "string" && type ? type : "?");
    return false;
  });
  return { genre: { ...genre, sources }, dropped };
}

/** 불러온 장르들을 새 행으로. 식별자가 겹치면 바꾸고(몇 개인지), 모르는 출처는 빼서 장르마다 무엇을 뺐는지 함께 */
function importedRows(files: Array<{ id: string; genre: GenreData }>, taken: Iterable<string>, known: ReadonlySet<string>): { rows: GenreRow[]; renamed: number; dropped: Array<{ name: string; types: string[] }> } {
  const names = new Set(taken);
  let renamed = 0;
  const dropped: Array<{ name: string; types: string[] }> = [];
  const rows = files.flatMap(({ id, genre }) => {
    const name = freeName(id, names);
    if (name !== id) renamed++;
    names.add(name);
    const kept = supportedOnly(genre, known);
    if (kept.dropped.length) dropped.push({ name, types: kept.dropped });
    return toRows({ [name]: kept.genre });
  });
  return { rows, renamed, dropped };
}

export { genreFile, parseGenreFile, importedRows };
