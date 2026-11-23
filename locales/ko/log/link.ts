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
};

export { link };
