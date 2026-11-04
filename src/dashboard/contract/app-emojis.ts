// 앱 이모지 경로(/api/app-emojis)의 공유 타입

/** 앱 이모지 하나. icon: 봇의 아이콘(동기화가 관리한다), char: 대시보드 입력란이 이 이모지를 그리는 문자(보조 사용자 정의 영역) */
type AppEmojiItem = { id: string; name: string; animated: boolean; icon: boolean; char: string };

/** 목록. fontVersion: 입력란용 그림 글꼴의 판(목록이 바뀌면 바뀐다) */
type AppEmojiList = { emojis: AppEmojiItem[]; fontVersion: string };

export type { AppEmojiItem, AppEmojiList };
