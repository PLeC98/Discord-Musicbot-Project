// 로그 문구: ZIP 읽기(infra/zip). 설정 불러오기, yt-dlp 받기 등 여러 분류의 줄에 값으로 들어간다

const zip = {
  receiverClosed: () => `받는 쪽이 닫힘`,
  readFailed: ({ why }: { why: string }) => `ZIP 파일 읽기 실패: ${why}`,
  notZip: () => `ZIP이 아님`,
  zip64NoLocator: () => `ZIP64 로케이터가 없음`,
  zip64EndBroken: () => `ZIP64 끝 레코드가 깨짐`,
  directoryBroken: () => `중앙 디렉터리가 깨짐`,
  entryEncrypted: ({ name }: { name: string }) => `암호가 걸린 항목(${name})`,
  badPath: ({ name }: { name: string }) => `받을 수 없는 경로(${name})`,
  tooManyEntries: ({ count }: { count: number }) => `항목이 너무 많음(${count}개)`,
  entryBroken: ({ name }: { name: string }) => `항목이 깨짐(${name})`,
  entryTruncated: ({ name }: { name: string }) => `항목이 잘림(${name})`,
  inflateFailed: ({ name }: { name: string }) => `압축 해제 실패(${name})`,
  unknownMethod: ({ name }: { name: string }) => `모르는 압축 방식(${name})`,
  contentMismatch: ({ name }: { name: string }) => `내용이 맞지 않음(${name})`,
  sizeMismatch: ({ name }: { name: string }) => `압축을 푼 크기가 맞지 않음(${name})`,
  unpackedTooBig: () => `풀린 크기가 너무 큼`,
  entryTooBig: ({ name }: { name: string }) => `항목이 너무 큼(${name})`,
  notRegularFile: ({ name }: { name: string }) => `일반 파일이 아닌 항목(${name})`,
  badName: ({ name }: { name: string }) => `받을 수 없는 이름(${name})`,
};

export { zip };
