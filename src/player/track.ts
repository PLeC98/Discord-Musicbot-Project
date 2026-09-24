// 트랙의 모양. 곡은 흐르면서 칸이 늘어나므로 단계마다 타입을 둔다. 값은 없고 타입만 있다.
//
// 링크 칸 셋은 하는 일이 다르다.
//   pageUrl     사람에게 보여 줄 링크. 누르면 가는 곳. 비우지 않는다
//   requestKey  무엇을 틀라고 했나. 링크 장부의 열쇠. 입력이면 다듬은 링크, 자동재생이면 <소스>:<곡 id>
//   audioUrl    소리를 받아 올 고정된 주소. 스포티파이는 영상을 찾기 전까지 없다
// 캐시 열쇠는 칸이 아니다. 쓸 때마다 audioKeyOf(audioUrl) 로 계산한다.
//
// platform 은 곡이 어디서 왔는지의 이름표다(화면과 대시보드 점 색). 어디서 받을지는 audioUrl 이 정한다.

import type { SessionTrackRow } from "../store/rows.ts";

/** 음원 주소를 어떻게 알았나. 장부에서 온 영상이 죽었으면 다시 찾는다. */
type AudioFoundBy = "given" | "ledger" | "search";

/** 소스가 준 것(링크 조회 · 검색 · 자동재생 후보). */
type TrackInfo = {
  title: string;
  artist?: string;
  album?: string;
  /** 초. 모르면 0 */
  duration: number;
  /** "추정" · "실측" · "미상" */
  durationSource?: string;
  thumbnail?: string | null;
  /** 어디서 온 곡인가(ui/platforms 의 이름) */
  platform: string;
  /** 소스 안의 id */
  id?: string;
  pageUrl: string;
  requestKey: string;
  audioUrl?: string;
  audioFoundBy?: AudioFoundBy;
  /** 담을 때의 답. 틀 때의 답은 CurrentPlayback 에 있다(플레이어의 isLive 가 둘을 고른다) */
  isLive?: boolean;
  /** 담을 때의 답 */
  liveStatus?: string | null;
};

/** 대기열에 담은 것. */
type QueuedTrack = TrackInfo & {
  requestedBy?: { id: string; username?: string; displayName?: string };
  addedAt?: number;
  autoplay?: boolean;
  pickedFrom?: string;
};

/** 세션 표의 한 줄. 되읽을 때 store/rows 의 스키마로 검사한 뒤 QueuedTrack 으로 바꾼다. */
type PersistedTrack = SessionTrackRow;

/** 재생 직전. 음원 주소가 반드시 있다(스포티파이는 영상을 찾아야 이 타입이 된다). */
type PlayableTrack = QueuedTrack & { audioUrl: string };

export type { AudioFoundBy, TrackInfo, QueuedTrack, PersistedTrack, PlayableTrack };
