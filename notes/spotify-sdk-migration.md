# Spotify SDK 마이그레이션 메모

## 현재 상황
- `spotify-web-api-node@5.0.2` 사용 중 — 아카이브된 비공식 패키지
- 부작용: `superagent@6.1.0`, `formidable@1.2.6` deprecated 경고 발생

## 교체 대상
`@spotify/web-api-ts-sdk@1.2.0` — Spotify 공식 SDK, CJS 지원(`require()` 가능), 활발히 유지보수됨

## 작업 범위
`src/Spotify.js` 한 파일만 수정하면 됨

### 인증 방식 변경
```js
// 현재
const SpotifyWebApi = require('spotify-web-api-node');
this.spotifyApi = new SpotifyWebApi({ clientId, clientSecret });
const data = await this.spotifyApi.clientCredentialsGrant();
this.spotifyApi.setAccessToken(data.body.access_token);

// 새 SDK — 토큰 갱신 자동 처리
const { SpotifyApi } = require('@spotify/web-api-ts-sdk');
this.spotifyApi = SpotifyApi.withClientCredentials(clientId, clientSecret);
```

### 메서드 대응표
| 현재 | 새 SDK |
|---|---|
| `spotifyApi.search(q, [type], opts)` | `spotifyApi.search(q, [type], market, limit)` |
| `spotifyApi.getTrack(id)` | `spotifyApi.tracks.get(id)` |
| `spotifyApi.getAlbum(id)` | `spotifyApi.albums.get(id)` |
| `spotifyApi.getAlbumTracks(id)` | `spotifyApi.albums.tracks(id)` |
| `spotifyApi.getPlaylist(id)` | `spotifyApi.playlists.getPlaylist(id)` |
| `spotifyApi.getPlaylistTracks(id)` | `spotifyApi.playlists.getPlaylistItems(id)` |
| `spotifyApi.getArtistTopTracks(id, market)` | `spotifyApi.artists.topTracks(id, market)` |

### 응답 포맷 변경
```js
// 현재
const result = await this.spotifyApi.getTrack(id);
result.body.name  // .body. 래핑

// 새 SDK
const result = await this.spotifyApi.tracks.get(id);
result.name  // 직접 접근
```

### 버려도 되는 메서드 (데드 코드 — 아무데서도 호출 안 됨)
- `getRecommendations()` — Spotify가 2024년에 API 삭제
- `getAudioFeatures()` — 마찬가지로 삭제됨
- `getAvailableGenres()` — 삭제됨
- `getUserPlaylists()` — 삭제됨

## 교체 후 기대 효과
- `superagent`, `formidable` deprecated 경고 제거
- 공식 SDK로 장기 안정성 확보
