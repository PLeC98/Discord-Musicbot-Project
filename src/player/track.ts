// 트랙의 모양. 곡은 흐르면서 필드가 늘어나므로 단계마다 타입을 둔다. 값은 없고 타입만 있다.
//
// 링크 필드 셋은 하는 일이 다르다.
//   pageUrl     사람에게 보여 줄 링크. 누르면 가는 곳. 비우지 않는다
//   requestKey  무엇을 틀라고 했나. 링크 데이터의 키. 입력이면 다듬은 링크, 자동재생이면 <소스>:<곡 id>
//   audioUrl    소리를 받아 올 고정된 주소. 스포티파이는 영상을 찾기 전까지 없다
// 캐시 키는 필드가 아니다. 쓸 때마다 audioKeyOf(audioUrl) 로 계산한다.
//
// platform 은 곡이 어디서 왔는지의 라벨이다(화면과 대시보드 점 색). 어디서 받을지는 audioUrl 이 정한다.

/** 음원 주소를 어떻게 알았나. 링크 데이터에서 온 영상이 죽었으면 다시 찾는다. */
type AudioFoundBy = "given" | "ledger" | "search";

/** 곡 길이가 어디서 왔나. provided: 출처가 준 값 · measured: 다운로드해 둔 음원을 잰 값 · unknown: 모른다(0). 적지 않았으면 provided */
type DurationSource = "provided" | "measured" | "unknown";

/** 소스가 준 것(링크 조회 · 검색 · 자동재생 후보). */
type TrackInfo = {
  /** 출처가 제목을 주지 않았으면 null. 그리는 쪽이 "알 수 없는 곡"으로 적는다 */
  title: string | null;
  artist?: string;
  album?: string | null;
  /** 초. 모르면 0 */
  duration: number;
  durationSource?: DurationSource;
  thumbnail?: string | null;
  /** 어디서 온 곡인가(rules/platforms 의 이름) */
  platform: string;
  /** 소스 안의 id */
  id?: string;
  pageUrl: string;
  requestKey: string;
  audioUrl?: string;
  audioFoundBy?: AudioFoundBy;
  /** 담을 때의 답. 틀 때의 답은 CurrentPlayback 에 있다(플레이어의 isLive 가 둘을 선택한다) */
  isLive?: boolean;
  /** 담을 때의 답 */
  liveStatus?: string | null;
};

/** 요청한 사람. 진입점이 접은 표준형(usecases/add-tracks 의 toRequester)이거나 디스코드 사용자. 복원한 곡은 id 뿐이다 */
type Requester = { id: string | null; username?: string | null; displayName?: string; tag?: string | null };

/** 대기열에 담은 것. */
type QueuedTrack = TrackInfo & {
  /** 대기열 줄 번호. track-state 가 들어올 때 찍는 열거되지 않는 필드(복사본에는 따라가지 않는다) */
  readonly entry?: number;
  requestedBy?: Requester | null;
  autoplay?: boolean;
  pickedFrom?: string;
};

/** 재생 직전. 음원 주소가 반드시 있다(스포티파이는 영상을 찾아야 이 타입이 된다). */
type PlayableTrack = QueuedTrack & { audioUrl: string };

export type { AudioFoundBy, DurationSource, TrackInfo, QueuedTrack, PlayableTrack, Requester };
