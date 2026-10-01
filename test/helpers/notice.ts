// 안내(ui/frame 의 Notice)를 시험에서 한 줄로 적는다: 경고 수준 · 이모지 · 머리 줄, 본문은 다음 줄에

import { EMOJI, type Notice } from "../../src/ui/frame.ts";

const shown = (notice: Notice) => `${notice.severity} ${EMOJI[notice.topic]} ${notice.title}${notice.body ? `\n${notice.body}` : ""}`;

export { shown };
