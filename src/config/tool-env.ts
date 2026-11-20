// 외부 도구(yt-dlp, ffmpeg, POToken 서버, 설치 스크립트가 실행하는 git, npm, tar, tsc)에 넘기는 환경 변수.
// 외부에서 다운로드한 코드(npm 의존성의 설치 스크립트, POToken 서버가 실행하는 BotGuard 코드, yt-dlp 플러그인)가 봇의 비밀값을 읽지 못하게 비밀값 환경 변수만 뺀다.
// .env의 변수를 통째로 빼지 않는다: 운영자가 설정한 프록시, 인증서, PATH는 외부 도구에도 필요하다

/** 설정 모듈이 환경 변수에서 읽는 비밀값. 설정 모듈이 새 비밀값을 읽게 되면 여기에 추가한다(test/config/tool-env가 검사한다) */
const SECRET_ENV_NAMES = ["DISCORD_TOKEN", "CLIENT_SECRET", "SECRETS_KEY", "SESSION_SECRET"] as const;

/** env에서 비밀값 환경 변수를 뺀 사본. Windows는 환경 변수 이름의 대소문자를 구분하지 않아 대소문자 구분 없이 비교한다 */
function toolEnv(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const fold = (name: string) => (platform === "win32" ? name.toUpperCase() : name);
  const secret = new Set<string>(SECRET_ENV_NAMES.map(fold));
  return Object.fromEntries(Object.entries(env).filter(([name]) => !secret.has(fold(name))));
}

export { SECRET_ENV_NAMES, toolEnv };
