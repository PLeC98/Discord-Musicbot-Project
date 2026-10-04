// config-folds.js 의 모양(봇 쪽 시험이 부를 때 쓴다)

export function genreFoldId(i: number): string;
export function sourceFoldId(genreIndex: number, i: number): string;
export function promptFoldId(i: number): string;
export function specialFoldId(i: number): string;
export function isFolded(id: string): boolean;
export function toggleFold(id: string): void;
export function isDeepOpen(id: string): boolean;
export function toggleDeepOpen(id: string): void;
export function reorderGenres(order: number[]): void;
export function reorderSources(genreIndex: number, order: number[]): void;
export function reorderSpecials(order: number[]): void;
