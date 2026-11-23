// 로그 문구: 설정(config 분류). 기동 때의 설정 검사와 로그 언어 고르기

const config = {
  /** 적은 LOG_LANGUAGE를 쓸 수 없어 다른 언어로 찍는다. malformed: 언어 태그 형식이 아님(아니면 그 언어의 로그 문구가 없음) */
  logLanguageIgnored: ({ value, malformed, language }: { value: string; malformed: boolean; language: string }) => `LOG_LANGUAGE 무시(${value}): ${malformed ? "언어 태그 형식이 아님" : "그 언어의 로그 문구가 없음"}. 로그 언어: ${language}`,
};

export { config };
