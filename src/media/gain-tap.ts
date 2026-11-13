// 게인 탭: 파이프라인(ffmpeg, 측정 단계, 출력 스트림) 하나가 볼륨 정규화의 게인을 묻고 측정값을 넘기는 곳.
// 만드는 것은 플레이어의 게인 조절기(player/gain-control)이고, media 는 player 를 부를 수 없어 타입만 여기 둔다.

/** 프레임 하나에 걸 정규화 게인(dB)과 리미터 켜짐 여부 */
type TapFrame = { gain: number; press: boolean };

type GainTap = {
  /** 출력 스트림이 프레임을 보낼 때마다 부른다. pos: 그 프레임의 시작 위치(이 파이프라인에서 지나간 채널당 샘플 수) */
  frame(pos: number): TapFrame;
  /** 지금 측정해야 하는지(측정 단계가 청크마다 본다) */
  metering(): boolean;
  /** 측정 단계가 400ms 블록마다(100ms 간격) 부른다. endPos: 그 블록이 끝난 위치, momentary: 순간 음량(LUFS), peak: 그 100ms 의 샘플 피크(dBFS) */
  block(endPos: number, momentary: number, peak: number): void;
  /** 파이프라인이 끝났을 때 부른다 */
  close(): void;
};

/**
 * 오디오 입력을 연 방식(resourceOf 가 탭을 열 때 넘긴다). kind: 캐시 파일, ffmpeg 가 직접 여는 매니페스트(HLS, DASH), 스트림 파이프.
 * live: 라이브인지, bounded: 끝이 있고 크기를 아는지(모르면 null), sizeBytes: 전체 크기, downloading: 재생과 동시에 캐시 다운로드를 시작했는지,
 * cacheFile: 캐시 파일로 열었으면 그 경로
 */
type PathFacts = { kind: "file" | "url" | "pipe"; live: boolean; bounded: boolean | null; sizeBytes: number | null; downloading: boolean; cacheFile: string | null };

type OpenTap = (facts: PathFacts) => GainTap;

export type { GainTap, TapFrame, PathFacts, OpenTap };
