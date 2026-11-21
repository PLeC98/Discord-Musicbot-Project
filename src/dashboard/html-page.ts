// 화면 앱 없이 서버가 직접 그리는 쪽(호스트 확인, 평문 접속 차단, 화면 빌드 안 됨, 오류 쪽). 보는 사람의 언어로 그리고 <html lang>을 적는다.
// 세션 처리 전의 쪽은 로그인한 사람을 알 수 없어 Accept-Language, 봇 기본 언어 차례로 고른다(ui/language의 viewerLanguage)

import type { Request } from "express";
import { infoOf, type Language } from "../rules/languages.ts";
import { viewerLanguage } from "../ui/language.ts";
import { textFor } from "../ui/text/index.ts";

/** 요청을 보낸 사람의 언어. 세션 처리 뒤면 로그인한 사람의 개인 언어부터 */
const pageLanguage = (req: Request): Language => viewerLanguage({ userId: req.session?.user?.id, acceptLanguage: req.get("accept-language") });

/** 보는 사람의 언어로 쪽 하나를 그린다. title이 없으면 문구표의 쪽 제목(대시보드) */
function htmlPage(req: Request, body: (T: ReturnType<typeof textFor>) => string, title?: string): string {
  const language = pageLanguage(req);
  const T = textFor(language);
  return `<!doctype html><html lang="${infoOf(language).htmlLang}"><meta charset="utf-8"><title>${title ?? T.pages.title}</title>${body(T)}`;
}

export { htmlPage };
