// 로그 문구: 직접 링크와 스트림(link 분류). HLS 재생목록 읽기

const link = {
  hlsSequenceTooBig: ({ value }: { value: string }) => `HLS 순번이 다룰 수 있는 크기를 넘음(${value})`,
  liveHlsPlaylistEnded: ({ url }: { url: string }) => `라이브 HLS의 목록이 끝남: ${url}`,
  hlsSegmentTailNotBlock: ({ bytes }: { bytes: number }) => `HLS 세그먼트의 끝이 블록이 되지 않아 마지막 ${bytes}바이트를 버림(암호문이 잘림)`,
  hlsSegmentTailDecryptFailed: ({ bytes }: { bytes: number }) => `HLS 세그먼트의 끝을 복호화하지 못해 마지막 ${bytes}바이트를 버림(패딩이 맞지 않음)`,
  hlsKeyCheckSkippedFetch: ({ error }: { error: string }) => `HLS 세그먼트의 키 확인 건너뜀(끝 블록을 받지 못함): ${error}`,
  hlsKeyCheckSkippedRead: ({ error }: { error: string }) => `HLS 세그먼트의 키 확인 건너뜀(끝 블록을 읽지 못함): ${error}`,
  hlsKeyCheckSkippedNotRange: () => `HLS 세그먼트의 키 확인 건너뜀(구간 응답이 아님)`,
  bodyStreamClosed: () => `본문 스트림이 닫힘`,
  bodyEndedEarly: ({ receivedBytes, totalBytes }: { receivedBytes: number; totalBytes: number }) => `본문을 다 받기 전에 끝남(${receivedBytes}/${totalBytes}B)`,
  bodyResumeRetry: ({ attempt, maxAttempts, offsetBytes, error }: { attempt: number; maxAttempts: number; offsetBytes: number; error: string }) => `본문 이어 받기(재시도 ${attempt}/${maxAttempts}, ${offsetBytes}B): ${error}`,
  aesSegmentSizeInvalid: ({ bytes }: { bytes: number }) => `AES-128 세그먼트의 크기가 16의 배수가 아님(${bytes})`,
  decryptedHeadInvalid: () => `복호화한 앞부분이 TS, ID3, fMP4로 시작하지 않음`,
  hlsKeyMismatch: ({ detail }: { detail: string }) => `HLS 세그먼트의 키가 맞지 않음(${detail})`,
  shortSegmentNotBlocks: () => `짧은 세그먼트의 암호문이 블록 단위가 아님`,
  shortSegmentPadBroken: () => `짧은 세그먼트의 끝 패딩이 깨짐`,
  shortSegmentNotContainer: () => `짧은 세그먼트가 TS, ID3, fMP4가 아님`,
  hlsKeyMismatchLastBlock: () => `HLS 세그먼트의 키가 맞지 않음(마지막 블록의 패딩이 깨짐)`,
  ignoredRangeShort: ({ offsetBytes }: { offsetBytes: number }) => `구간을 무시한 응답이 이미 받은 위치(${offsetBytes}B)보다 짧음`,
  resumedTotalChanged: ({ totalBytes, size }: { totalBytes: number; size: string }) => `이어 받은 본문의 전체 크기가 다름: 처음 ${totalBytes}B, 지금 ${size}B`,
  ignoredRangeNoValidator: () => `서버가 구간을 무시했는데 검증값이 없어 같은 본문인지 알 수 없음`,
  bodyChanged: () => `본문이 바뀜(검증값이 다름)`,
  refetchedTotalChanged: ({ totalBytes, size }: { totalBytes: number; size: number }) => `다시 받은 본문의 전체 크기가 다름: 처음 ${totalBytes}B, 지금 ${size}B`,
  ignoredRangeDiscardOverCap: ({ discardBytes, maxBytes }: { discardBytes: number; maxBytes: number }) => `서버가 구간을 무시해서, 버릴 앞부분(${discardBytes}B)이 상한(${maxBytes}B)을 넘음`,
  /** contentRange: 받은 Content-Range(없으면 null) */
  resumedRangeMismatch: ({ offsetBytes, contentRange }: { offsetBytes: number; contentRange: string | null }) => `이어 받은 구간이 어긋남: ${offsetBytes}B부터 요청, ${contentRange ?? "Content-Range 없음"}`,
};

export { link };
