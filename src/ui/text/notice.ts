// 안내 하나의 모양. 디스코드(ui/frame)와 대시보드가 같이 그린다. 이모지, 색은 그리는 쪽이 topic, severity로 선택한다

import { PROBLEMS, type Code, type NeedsParams, type Params, type ParamsOf } from "../../rules/problems.ts";

/** 무엇에 관한 안내인가. 사용자가 할 일이 같으면 한 주제 */
type Topic = "failed" | "permission" | "voice" | "stale" | "input" | "notFound" | "link" | "blocked" | "live" | "waiting" | "muted" | "autoplay" | "state";
/** 오류, 경고 안내. error는 봇 쪽 문제, warning은 사용자가 고칠 수 있거나 지금 상태라 못 한 것. 요청의 문제면 그 코드(code)를 단다 */
type Notice = { code?: Code; topic: Topic; severity: "error" | "warning"; title: string; body?: string };

/** 안내 하나. 본문이 없으면 필드를 두지 않는다 */
const noticeOf = (severity: Notice["severity"], topic: Topic, title: string, body?: string): Notice => (body ? { topic, severity, title, body } : { topic, severity, title });

/**
 * 그리는 쪽마다 다른 값의 형식. 디스코드는 채널을 멘션으로, 봇 개발자를 저장소 링크로 적는다(ui/mentions의 discordLook).
 * 대시보드는 글자로 적고, 보고할 곳은 화면이 따로 붙인다(utils/problem)
 */
type LinkLook = { channel: (id: string) => string; developer: () => string };

/** 오류, 거절 안내의 문장표. 언어 모듈(locales/<언어>/bot/errors)이 코드마다 하나씩 둔다 */
type ErrorTable = { [C in Code]: (p: ParamsOf<C>, look: LinkLook) => Notice };

/** 언어의 문장표(table)와 꾸밈 없는 형식(plain, 대시보드)으로 안내를 찾는 함수들. 찾는 법은 언어와 상관없다 */
function bindErrors(table: ErrorTable, plain: LinkLook) {
  /** 코드의 안내. params는 그 코드의 문장에 드는 값(rules/problems의 params, 모두 있어야 한다), look은 그리는 쪽의 값 형식 */
  function notice<C extends Code>(code: C, ...[params, look = plain]: NeedsParams<C> extends true ? [params: ParamsOf<C>, look?: LinkLook] : [params?: ParamsOf<C>, look?: LinkLook]): Notice {
    // 코드마다 다른 값 타입을 한 테이블에서 꺼내므로 여기서만 넓힌다(위 시그니처가 맞춰 넘겼다)
    const text = table[code] as (p: Params, look: LinkLook) => Notice;
    return { code, ...text(params ?? {}, look) };
  }

  /**
   * 실행 중에 코드가 정해진 문제의 안내(대시보드 응답, 곡 추가 결과). 그 코드에 드는 값이 빠졌으면 문장을 그리지 않고 알 수 없는 오류로,
   * 빠진 이름은 missing으로 넘긴다(봇은 로그에 남기고, 화면은 그대로 보인다)
   */
  function noticeFor(code: Code, params: Params = {}, look: LinkLook = plain, missing?: (names: string[]) => void): Notice {
    const names = ((PROBLEMS[code] as { params?: readonly (keyof Params)[] }).params ?? []).filter((name) => params[name] === undefined);
    if (names.length) {
      missing?.(names);
      return notice("unknown-error", {}, look);
    }
    return { code, ...(table[code] as (p: Params, look: LinkLook) => Notice)(params, look) };
  }

  return { notice, noticeFor, PLAIN: plain };
}

export { noticeOf, bindErrors };
export type { Notice, Topic, LinkLook, ErrorTable };
