// 음원이 사라졌는가(일시 오류가 아니라). 직접 지정한 음원이 죽었을 때 지정을 건너뛰고 다시 찾을지를 이것으로 가른다.
// 일시 오류(네트워크 · 5xx · 요청 제한)로 지정을 버리지 않게 사라졌다고 확실한 답만 본다:
//   유튜브        영상이 내려갔다 · 비공개(isVideoUnavailableError, 연령 제한은 뺀다)
//   사운드클라우드 404(unavailable-contents) · 미리듣기만 열린 곡(sc-preview-only)
//   직접 링크     404 · 410. 직접 링크는 모든 실패를 direct-unavailable 하나로 묶으므로 원인의 HTTP 상태로 가린다.
//                 음원이 아닌 응답(unsupported-link: 지운 파일 자리에 웹 페이지를 주는 서버)도
//   라이브        지정한 음원이 라이브(pinned-live: 라이브는 지정할 수 없다. 결과는 "live")

import { isVideoUnavailableError } from "./youtube/errors.ts";
import { codeOf } from "../rules/error-kind.ts";

/** 사라졌으면 그 문제 코드(재생 테스트 결과로 남긴다), 아니면 null */
function deadSourceCode(error: unknown): string | null {
  if (isVideoUnavailableError(error)) return "unavailable-contents";
  const code = codeOf(error);
  if (code === "pinned-live") return "live";
  if (code === "unavailable-contents" || code === "sc-preview-only" || code === "unsupported-link") return code;
  if (code === "direct-unavailable") {
    const cause = (error as { cause?: unknown } | null)?.cause;
    const text = cause instanceof Error ? cause.message : String(cause ?? "");
    if (/HTTP (?:404|410)\b/.test(text)) return code;
  }
  return null;
}

export { deadSourceCode };
