// 큰 파일 업로드(운영자 패널). /api/admin/uploads. 시작 { purpose, size } → UploadStarted, 청크 PUT ?offset= → UploadProgress, 상태 GET → UploadStatus.
// 다 올리면 용도별 기능 경로가 업로드 id로 가져간다(백업 미리 보기, 로그인 배경 올리기)

/** 용도: 백업 불러오기의 파일, 로그인 배경 */
const UPLOAD_PURPOSES = ["archive", "login-background"] as const;
type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** chunkSize: 청크 하나의 상한(바이트) */
type UploadStarted = { id: string; chunkSize: number; received: number };
type UploadProgress = { received: number };
type UploadStatus = { received: number; size: number };

export { UPLOAD_PURPOSES };
export type { UploadPurpose, UploadStarted, UploadProgress, UploadStatus };
