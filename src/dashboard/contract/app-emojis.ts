// 앱 이모지 경로(/api/app-emojis)의 공유 타입과 한도

/** 디스코드 앱 하나의 앱 이모지 한도 */
const APP_EMOJI_LIMIT = 2000;

/** 앱 이모지 하나. icon: 봇의 아이콘(동기화가 관리한다), char: 대시보드 입력란이 이 이모지를 그리는 문자(보조 사용자 정의 영역) */
type AppEmojiItem = { id: string; name: string; animated: boolean; icon: boolean; char: string };

/** 목록. fontVersion: 입력란용 그림 글꼴의 버전(목록이 바뀌면 바뀐다), room: 운영자 패널에서 더 올릴 수 있는 수(봇 준비 전이면 0) */
type AppEmojiList = { emojis: AppEmojiItem[]; fontVersion: string; room: number };

/** 앱 이모지를 쓰는 곳: 음성 상태 설정의 키, 장르 식별자 */
type AppEmojiUses = { voice: string[]; genres: string[] };

export { APP_EMOJI_LIMIT };
export type { AppEmojiItem, AppEmojiList, AppEmojiUses };
