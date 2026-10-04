// 요청 한 곳. 화면의 모든 axios 요청이 이 가로채기를 거친다: CSRF 토큰 · 토큰 거절 뒤 한 번 다시 보내기 · 세션 끝 · 시간 한도
// 시간 한도는 종류별이다. 기본은 조작 · 읽기 · 저장(10초), 부르기 · 곡 넣기 · 더 넣기와 운영자의 오래 걸리는 일은 120초,
// 바깥 AI 를 부르는 운영자 시험은 서버의 AI 설정이 한도를 정하므로 화면은 걸지 않는다(0)

export const LIMIT = { short: 10_000, long: 120_000, none: 0 };

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 응답 없이 실패한 요청의 종류. 시간 한도 · 연결 안 됨 · 화면이 끊음(페이지를 떠남 등) · 그 밖(응답이 있었다) */
export function failureKind(error) {
  if (error?.response) return null;
  if (error?.code === "ETIMEDOUT") return "timeout";
  if (error?.code === "ERR_NETWORK") return "offline";
  if (error?.code === "ECONNABORTED" || error?.code === "ERR_CANCELED") return "aborted";
  return null;
}

/**
 * http(axios) 에 가로채기를 건다.
 * onSessionEnd: 401 을 받았을 때. 요청은 그대로 실패한다(부른 쪽이 처리 중을 푼다).
 * 요청에 quietSession 을 주면 401 이어도 부르지 않는다(로그아웃).
 * onReach(ok): 서버에 닿았는지(응답이 왔다 · 연결이 안 됐다). 시간 한도 · 끊음은 알리지 않는다
 */
export function installRequests(http, { onSessionEnd, onReach }) {
  let token = null;
  let tokenRequest = null;

  http.defaults.withCredentials = true;
  http.defaults.timeout = LIMIT.short;
  // 시간 한도를 연결 끊김(ECONNABORTED)과 가르려고 ETIMEDOUT 으로 받는다
  http.defaults.transitional = { ...http.defaults.transitional, clarifyTimeoutError: true };

  function csrfToken() {
    if (token) return Promise.resolve(token);
    tokenRequest ??= http
      .get("/api/csrf-token", { quietSession: true })
      .then((res) => (token = res.data.csrfToken))
      .finally(() => (tokenRequest = null));
    return tokenRequest;
  }

  http.interceptors.request.use(async (request) => {
    if (!UNSAFE.has((request.method || "GET").toUpperCase())) return request;
    try {
      request.headers["X-CSRF-Token"] = await csrfToken();
    } catch (error) {
      // 토큰을 못 받은 실패는 이 요청의 실패다(세션 끝이면 이 요청의 quietSession 을 따른다). 같은 토큰 요청을 기다린 다른 요청과 오류를 나눠 쓰지 않게 복사한다
      throw Object.assign(Object.create(Object.getPrototypeOf(error)), error, { config: request });
    }
    return request;
  });

  http.interceptors.response.use(
    (res) => {
      onReach(true);
      return res;
    },
    (error) => {
      if (error?.response) onReach(true);
      else if (failureKind(error) === "offline") onReach(false);
      const request = error?.config;
      // 토큰은 처리기보다 앞에서 거절되므로 다시 보내도 같은 일이 두 번 되지 않는다. 새 토큰으로 정확히 한 번만
      if (error?.response?.data?.code === "bad-csrf-token") {
        token = null;
        if (request && !request.csrfRetried) return http.request({ ...request, csrfRetried: true });
      }
      if (error?.response?.status === 401 && !request?.quietSession) onSessionEnd();
      return Promise.reject(error);
    },
  );
}
