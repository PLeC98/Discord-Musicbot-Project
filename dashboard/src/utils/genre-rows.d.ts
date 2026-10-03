// genre-rows.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

type Genre = Record<string, unknown> & { emoji?: string; sources?: Record<string, unknown>[] };
type Row = { key: number; name: string; emoji: string; sources: Record<string, unknown>[]; kept: Genre };

export function toRows(genres: Record<string, Genre> | null | undefined): Row[];
export function toMap(rows: Row[]): Record<string, Genre>;
export function newRow(): Row;
