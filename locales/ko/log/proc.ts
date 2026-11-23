// 로그 문구: 외부 프로세스(proc 분류). 자식 프로세스의 기록과 정리, 메모리, 프로세스 목록, 콘솔 코드 페이지, 업로드 측정 도우미

const proc = {
  codePageMissing: () => `콘솔 코드 페이지 확인 실패: OEMCP 값 없음. 외부 프로세스의 오류 메시지가 깨질 수 있음`,
  codePageCheckFailed: ({ error }: { error: string }) => `콘솔 코드 페이지 확인 실패(외부 프로세스의 오류 메시지가 깨질 수 있음): ${error}`,
  leftoverKillFailed: ({ pid, error }: { pid: number; error: string }) => `pid ${pid} 종료 실패: ${error}`,
  leftoverDirReadFailed: ({ dir, error }: { dir: string; error: string }) => `기동 시 자식 프로세스 기록 폴더 읽기 실패(이전 실행의 잔류 프로세스 정리 건너뜀): ${dir} | ${error}`,
  leftoverRecordReadFailed: ({ file, error, code }: { file: string; error: string; code: string }) => `잔류 자식 프로세스 정리 중 기록 파일 읽기 실패(파일 삭제, 해당 자식 프로세스 확인 건너뜀): ${file} | ${error} (${code})`,
  leftoverRecordParseFailed: ({ name, reason }: { name: string; reason: string }) => `잔류 자식 프로세스 정리 중 기록 파일 파싱 실패(파일 삭제, 해당 자식 프로세스 확인 건너뜀): ${name} | 원인=${reason}`,
  leftoverOwnerAlive: ({ pid }: { pid: number }) => `기록을 남긴 봇 프로세스(pid ${pid})가 아직 실행 중이라 그 기록의 잔류 자식 프로세스 정리를 건너뜀. 봇이 중복 실행 중인지 확인하세요`,
  leftoverKilled: ({ count, pids }: { count: number; pids: string }) => `이전 실행의 잔류 자식 프로세스 ${count}개 종료: ${pids}`,
  childMemoryRead: () => `자식 프로세스 메모리 읽기`,
  registryFileWrite: () => `자식 프로세스 레지스트리 기록 파일 쓰기`,
  exitCleanupKilled: ({ count, children }: { count: number; children: string }) => `종료 처리를 거치지 않고 나가며 외부 프로세스 ${count}개 정리: ${children}`,
  childKillFailed: ({ names, why }: { names: string; why: string }) => `${names} 종료 실패: ${why}`,
  childStopFailed: ({ error }: { error: string }) => `자식 프로세스 종료 실패: ${error}`,
  snapshotProcReadFailed: ({ action, file, error, code }: { action: string; file: string; error: string; code: string }) => `프로세스 스냅샷 /proc 읽기 실패(${action}): ${file} | ${error} (${code})`,
  processListProcFailed: ({ error }: { error: string }) => `프로세스 목록 읽기 실패(/proc): ${error}`,
  processListFailed: ({ what, error }: { what: string; error: string }) => `프로세스 목록 읽기 실패(${what}): ${error}`,
  processListExit: ({ what, code, detail }: { what: string; code: string; detail: string }) => `프로세스 목록 읽기 실패(${what} 종료 코드 ${code})${detail}`,
  systemUploadRead: () => `시스템 업로드 읽기`,
  uploadHelperIdleExit: ({ exit, seconds, retrySeconds, stderr }: { exit: string; seconds: number; retrySeconds: number; stderr: string }) => `시스템 업로드 측정 PowerShell 헬퍼 유휴 중 종료(대기 중인 쿼리 없음): 종료=${exit} | 실행 시간=${seconds}초 | 재실행 대기=${retrySeconds}초 | stderr=${stderr}`,
  /** taskkill로 잔류 자식 프로세스를 끝내지 못했다. error: 실행 오류의 메시지(없으면 종료 코드 status와 stderr를 쓴다) */
  leftoverTaskkillFailed: ({ pid, error, status, stderr }: { pid: number; error: string | null; status: string; stderr: string }) => `pid ${pid} 종료 실패: ${error ?? `taskkill 종료 코드 ${status} · ${stderr}`}`,
  /** 프로세스 목록을 읽지 못해 잔류 자식 프로세스 기록을 두었다. kept: 둔 기록 수, removed: 7일 넘어 지운 기록 수 */
  leftoverUncheckedKept: ({ kept, removed }: { kept: number; removed: number }) => `잔류 자식 프로세스를 확인하지 못해 기록 ${kept}개를 두고 다음 기동에서 다시 확인${removed ? `(7일 넘은 기록 ${removed}개는 삭제)` : ""}`,
};

export { proc };
