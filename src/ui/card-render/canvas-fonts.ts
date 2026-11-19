// 그리기 워커(render-worker)의 글꼴 등록과 해제. 등록한 글꼴은 프로세스 전체에 남아 워커를 종료해도 해제되지 않으므로,
// 워커는 끝나기 전에 releaseFonts 로 지운다(@napi-rs/canvas 1.1.1 부터 지운 글꼴의 메모리가 풀린다)

import { GlobalFonts, type FontKey } from "@napi-rs/canvas";
import { FONTS, fontPath } from "./fonts.ts";

let keys: Array<FontKey | null> | null = null;

/** 처음 그릴 때 한 번 등록한다 */
function ensureFonts() {
  keys ??= FONTS.map((one) => GlobalFonts.registerFromPath(fontPath(one.file), one.family));
}

/** 등록한 글꼴을 지워 메모리를 해제한다. 워커가 끝나기 직전에 부른다 */
function releaseFonts() {
  for (const key of keys ?? []) if (key) GlobalFonts.remove(key);
  keys = null;
}

export { ensureFonts, releaseFonts };
