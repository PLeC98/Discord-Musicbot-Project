// 인증 · 세션이 실리는 요청 헤더. 화면에 보일 때 가리고(autoplay/assist 의 미리보기), AI 설정의 추가 인자에 입력하지 못하게 한다(config/schema/ai).
// 하나를 더할 때 두 곳이 같이 따른다

const SECRET_HEADERS = ["authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "api-key", "cookie"];

const isSecretHeader = (name: string) => SECRET_HEADERS.includes(name.trim().toLowerCase());

/** 추가 인자 텍스트(한 줄에 하나, header::이름=값)에 비밀 헤더에 값을 넣는 줄이 있는가. 빼는 줄({{none}})은 괜찮다 */
function setsSecretHeader(text: string) {
  return text.split(/\r?\n/).some((line) => {
    const m = /^\s*header::([^=]+)=(.*)$/i.exec(line);
    return m !== null && isSecretHeader(m[1]) && m[2].trim() !== "{{none}}";
  });
}

export { SECRET_HEADERS, isSecretHeader, setsSecretHeader };
