// 브라우저처럼 응답의 Set-Cookie를 이름별로 보관한다. 한 응답이 쿠키를 여럿 붙이거나(로그인 콜백: 로그인 쿠키 삭제와 세션 쿠키) 삭제한다.
// 삭제된 쿠키(빈 값, 과거 만료일, Max-Age=0)는 뺀다. 경로, 도메인, Secure는 보지 않는다(테스트는 한 호스트의 평문)

type Cookie = { name: string; value: string; attrs: string };

function cookieJar() {
  const jar = new Map<string, Cookie>();
  return {
    /** 응답이 붙인 쿠키들을 보관한다. 그 응답이 붙인 것(삭제 포함)을 돌려준다 */
    take(res: Response): Cookie[] {
      const set = res.headers.getSetCookie().map((line) => {
        const [pair, ...rest] = line.split(";");
        const at = pair.indexOf("=");
        return { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), attrs: rest.join(";") };
      });
      for (const one of set) {
        const gone = !one.value || /expires=thu, 01 jan 1970/i.test(one.attrs) || /max-age=0(?:;|$)/i.test(one.attrs);
        if (gone) jar.delete(one.name);
        else jar.set(one.name, one);
      }
      return set;
    },
    /** 요청에 실을 Cookie 헤더를 만든다 */
    header: () => [...jar.values()].map(({ name, value }) => `${name}=${value}`).join("; "),
    get: (name: string) => jar.get(name)?.value ?? null,
    /** 보관 중인 쿠키의 이름 목록을 돌려준다 */
    names: () => [...jar.keys()],
    clear: () => jar.clear(),
  };
}

export { cookieJar };
export type { Cookie };
