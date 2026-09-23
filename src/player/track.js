"use strict";

// 트랙의 모양. 곡은 흐르면서 칸이 늘어나므로 단계마다 타입을 둔다. 값은 없고 타입만 있다.
//
// 링크 칸 셋은 하는 일이 다르다.
//   pageUrl     사람에게 보여 줄 링크. 누르면 가는 곳. 비우지 않는다
//   requestKey  무엇을 틀라고 했나. 링크 장부의 열쇠. 입력이면 다듬은 링크, 자동재생이면 <소스>:<곡 id>
//   audioUrl    소리를 받아 올 고정된 주소. 스포티파이는 영상을 찾기 전까지 없다
// 캐시 열쇠는 칸이 아니다. 쓸 때마다 audioKeyOf(audioUrl) 로 계산한다.
//
// platform 은 곡이 어디서 왔는지의 이름표다(화면과 대시보드 점 색). 어디서 받을지는 audioUrl 이 정한다.

/**
 * @typedef {"given" | "ledger" | "search"} AudioFoundBy
 * 음원 주소를 어떻게 알았나. 장부에서 온 영상이 죽었으면 다시 찾는다.
 */

/**
 * 소스가 준 것(링크 조회 · 검색 · 자동재생 후보).
 * @typedef {object} TrackInfo
 * @property {string} title
 * @property {string} [artist]
 * @property {string} [album]
 * @property {number} duration 초. 모르면 0
 * @property {string} [durationSource] "추정" · "실측" · "미상"
 * @property {string | null} [thumbnail]
 * @property {string} platform 어디서 온 곡인가(ui/platforms 의 이름)
 * @property {string} [id] 소스 안의 id
 * @property {string} pageUrl
 * @property {string} requestKey
 * @property {string} [audioUrl]
 * @property {AudioFoundBy} [audioFoundBy]
 * @property {boolean} [isLive] 담을 때의 답. 재생할 때의 답은 CurrentPlayback 에 있다
 * @property {string | null} [liveStatus]
 */

/**
 * 대기열에 담은 것.
 * @typedef {TrackInfo & {
 *   requestedBy?: { id: string, username?: string, displayName?: string },
 *   addedAt?: number,
 *   autoplay?: boolean,
 *   pickedFrom?: string,
 * }} QueuedTrack
 */

/**
 * 재생 직전. 음원 주소가 반드시 있다(스포티파이는 영상을 찾아야 이 타입이 된다).
 * @typedef {QueuedTrack & { audioUrl: string }} PlayableTrack
 */

module.exports = {};
