// 안내(ui/text/notice 의 Notice)를 시험에서 한 줄로 적는다: 경고 수준 · 이모지 · 머리 줄, 본문은 다음 줄에

import { EMOJI } from "../../src/ui/frame.ts";
import type { Notice } from "../../src/ui/text/notice.ts";

/** 머리 줄과 본문의 글자만(이모지 없이) */
const plainText = (notice: Notice) => (notice.body ? `${notice.title}\n${notice.body}` : notice.title);

const shown = (notice: Notice) => `${notice.severity} ${EMOJI[notice.topic]} ${notice.title}${notice.body ? `\n${notice.body}` : ""}`;

export { shown, plainText };
