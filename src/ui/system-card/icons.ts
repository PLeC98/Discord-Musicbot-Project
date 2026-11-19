// /system 이미지의 아이콘(Material Symbols Rounded). 윤곽은 scripts/build-discord-icons.ts 가 data/discord-icons/system-card.json 에 뽑는다

/** 카드 제목과 현황 줄의 아이콘. 채우지 않은 모양 */
const CARD_ICONS = ["memory", "terminal", "library_music", "hard_drive", "timer", "graphic_eq", "public", "headphones", "person"] as const;
/** 상태 카드의 아이콘. 단계(정상, 주의, 위험)마다 채운 모양 */
const STATUS_ICONS = ["check_circle", "warning", "cancel"] as const;

type CardIcon = (typeof CARD_ICONS)[number];
type StatusIcon = (typeof STATUS_ICONS)[number];

export { CARD_ICONS, STATUS_ICONS };
export type { CardIcon, StatusIcon };
