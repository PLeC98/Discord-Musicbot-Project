// 설정 DB 스냅샷의 형식(store/snapshots 가 만들고 대시보드 백업 탭이 보인다). 화면도 부르므로 Node 없는 모듈이다.

/** daily: 하루 한 번, before-import · before-restore · before-reset: 가져오기 · 복원 · 초기화로 바꾸기 전 */
type SnapshotKind = "daily" | "before-import" | "before-restore" | "before-reset";
/** 스냅샷 하나. at: 뜬 때(ms), bytes: 크기 */
type Snapshot = { name: string; kind: SnapshotKind; at: number; bytes: number };
/** 백업 탭의 목록. staged: 다음 기동에 복원하려고 예약한 스냅샷(없으면 null) */
type SnapshotsView = { rows: Snapshot[]; staged: string | null };

export type { SnapshotKind, Snapshot, SnapshotsView };
