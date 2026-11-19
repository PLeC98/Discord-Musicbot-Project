// 봇이 그리는 이미지(/system 카드, /queue 썸네일)의 아이콘(Material Symbols Rounded). 윤곽은 scripts/build-discord-icons.ts 가 data/discord-icons/card-icons.json 에 뽑는다

/** 카드 제목, 현황 줄, 썸네일이 없는 칸의 아이콘. 채우지 않은 모양 */
const CARD_ICONS = ["memory", "terminal", "library_music", "hard_drive", "timer", "graphic_eq", "public", "headphones", "person", "music_note"] as const;
/** 상태 카드의 아이콘. 단계(정상, 주의, 위험)마다 채운 모양 */
const STATUS_ICONS = ["check_circle", "warning", "cancel"] as const;

type CardIcon = (typeof CARD_ICONS)[number];
type StatusIcon = (typeof STATUS_ICONS)[number];

export { CARD_ICONS, STATUS_ICONS };
export type { CardIcon, StatusIcon };
