// 설정 DB 스냅샷의 꼴(store/snapshots 가 만들고 대시보드 설정 탭이 보인다). 화면도 부르므로 Node 없는 모듈이다.

/** daily: 하루 한 번, before-import · before-restore: 가져오기 · 되살리기로 바꾸기 전 */
type SnapshotKind = "daily" | "before-import" | "before-restore";
/** 스냅샷 하나. at: 뜬 때(ms), bytes: 크기 */
type Snapshot = { name: string; kind: SnapshotKind; at: number; bytes: number };
/** 설정 탭의 목록. staged: 다음 기동에 되살리려고 걸어 둔 스냅샷(없으면 null) */
type SnapshotsView = { rows: Snapshot[]; staged: string | null };

export type { SnapshotKind, Snapshot, SnapshotsView };
