// 로그 문구: 스포티파이(spotify 분류). 곡과 목록 조회, 익명 토큰과 번들 해시 추출, API 키 확인

const spotify = {
  albumNotFound: ({ id }: { id: string }) => `앨범 없음(NotFound) ${id}`,
  playlistNotFound: () => `플레이리스트 접근 불가(NotFound)`,
  apiKeyMissing: () => `Spotify 키 미설정(운영자 패널의 API 키 탭)`,
  searchChunkMissing: () => `번들에 검색 화면 청크가 없음`,
  searchChunkStatus: ({ status }: { status: number }) => `검색 청크 ${status}`,
  searchHashMissing: () => `검색 청크에 searchTracks 해시가 없음`,
  anonStateFailed: ({ error }: { error: string }) => `익명 상태 받기 실패: ${error}`,
  anonStateExtractFailed: ({ error }: { error: string }) => `익명 상태 추출 실패: ${error}. 저장값 사용`,
  homeStatus: ({ status }: { status: number }) => `홈 ${status}`,
  clientVersionReadFailed: ({ clientVersion, error }: { clientVersion: string; error: string }) => `clientVersion 읽기 실패(직전 값 ${clientVersion}): ${error}`,
  bundleUrlMissing: () => `홈에 웹플레이어 번들 주소가 없음`,
  bundleStatus: ({ status }: { status: number }) => `번들 ${status}`,
  bundleSecretMissing: () => `번들에서 secret을 찾지 못함`,
  anonTokenStatus: ({ status }: { status: number }) => `익명 토큰 ${status}`,
  anonTokenRetry: ({ status }: { status: number }) => `익명 토큰 오류 ${status}(secret을 다시 추출해 재시도)`,
  operationHashMissing: ({ hashKey }: { hashKey: string }) => `${hashKey} 해시가 없음(번들에서 못 찾음)`,
  anonTokenRejected: () => `익명 토큰이 거절됨(401)`,
  graphqlParseFailed: ({ status }: { status: number }) => `GraphQL 응답 파싱 실패 ${status}`,
  hashExpired: () => `저장된 해시 만료(다시 추출해 재시도)`,
  anonTokenRejectedRetry: () => `익명 토큰이 거절됨(새로 받아 재시도)`,
  trackNotFound: ({ id }: { id: string }) => `곡 없음(NotFound) ${id}`,
  collectionLoaded: ({ type, id, count, range, head }: { type: string; id: string; count: number; range: string; head: string }) => `${type} ${id} → ${count}곡${range}: ${head}`,
  trackSearch: () => `곡 검색`,
  anonPrepareFailed: ({ error }: { error: string }) => `익명 경로 준비 실패(쓸 때 다시 시도): ${error}`,
  apiKeyCheckHttp: ({ status }: { status: number }) => `API 키 확인 실패: HTTP ${status}`,
  apiKeyCheckFailed: ({ error }: { error: string }) => `API 키 확인 실패: ${error}`,
};

export { spotify };
