// 로그 문구: 직접 링크와 스트림(link 분류). HLS 재생목록 읽기

const link = {
  hlsSequenceTooBig: ({ value }: { value: string }) => `HLS 순번이 다룰 수 있는 크기를 넘음(${value})`,
};

export { link };
