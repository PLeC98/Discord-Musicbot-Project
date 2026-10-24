// 대시보드가 내려주는 디스코드 그림 주소. 목록에 작게 그리는 것은 같은 크기로. 움직이는 그림은 gif 그대로 둔다

import { CDN } from "discord.js";

const cdn = new CDN();
const SMALL = { size: 64, extension: "webp" } as const;

/** 사용자 프로필 그림. 그림이 없으면 null */
const avatarUrl = (userId: string, hash: string | null | undefined) => (hash ? cdn.avatar(userId, hash, SMALL) : null);

/** 서버 아이콘. 아이콘이 없으면 null */
const guildIconUrl = (guildId: string, hash: string | null | undefined) => (hash ? cdn.icon(guildId, hash, SMALL) : null);

export { avatarUrl, guildIconUrl };
