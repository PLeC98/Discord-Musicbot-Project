// ESLint flat config. 목적은 버그 탐지(미사용 변수·미정의 참조·await 실수 등)
// 코드 모양은 Prettier 담당 - eslint-config-prettier로 스타일 규칙을 전부 끔

import js from "@eslint/js";
import globals from "globals";
import pluginVue from "eslint-plugin-vue";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules",
      "bgutil-ytdlp-pot-provider", // 외부 클론
      "dashboard/client/dist", // 빌드 산출물
      "database",
      "cache",
      "notes",
    ],
  },

  js.configs.recommended,

  // 남은 .js(이 설정 파일 · 대시보드 클라이언트) - ESM. require · __dirname 은 없는 이름이다(nodeBuiltin). 클라이언트는 아래에서 브라우저로
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.nodeBuiltin,
    },
  },

  // 봇 본체는 TypeScript. 파서와 권장 규칙(타입 정보 없이 도는 것만). 봇 본체 품질 규칙은 아래에서 건다
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.ts"] })),
  {
    files: ["**/*.ts"],
    languageOptions: { globals: globals.nodeBuiltin },
    rules: {
      // 아래 no-unused-vars 와 같은 기준
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },

  // 대시보드 클라이언트 - Vue 3 + 브라우저 (essential = 오류 방지 규칙만, 스타일은 Prettier)
  ...pluginVue.configs["flat/essential"],
  {
    files: ["dashboard/client/src/**/*.{js,vue}"],
    languageOptions: {
      sourceType: "module",
      globals: globals.browser,
    },
  },

  prettierConfig,

  {
    rules: {
      // 테스트와 대시보드 클라이언트에서는 빈 catch 를 허용한다. 봇 쪽 코드는 아래에서 막는다
      "no-empty": ["error", { allowEmptyCatch: true }],
      // 미사용이라도 _ 접두사와 catch 파라미터는 허용 (API 시그니처 유지용),
      // rest 생략용 구조분해(const { omit, ...rest })도 허용
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // 제어문자 매칭은 이 코드베이스의 정당한 용례 (ANSI 이스케이프 제거, 입력 정규화 방어)
      "no-control-regex": "off",
      // 같은 범위에서 선언보다 먼저 쓰면 불러오는 순간 던진다(TDZ). 안쪽 함수가 뒤에 선언된 것을 가리키는 것은 괜찮다
      "no-use-before-define": ["error", { functions: false, classes: false, variables: false }],
    },
  },

  // 봇 쪽 코드의 품질 게이트. 억제 파일은 쓰지 않는다. 넘으면 고치고, 고칠 값이 없을 때만
  // 그 줄에 `// eslint-disable-next-line <규칙> -- 이유` 를 단다.
  // 일부러 비워 둔 catch · 함수는 안에 이유 주석을 적는다(주석이 있으면 빈 것으로 안 본다).
  {
    files: ["src/**/*.ts", "commands/**/*.ts", "events/**/*.ts", "dashboard/server/**/*.ts", "index.ts", "config.ts", "scripts/**/*.ts"],
    rules: {
      complexity: ["error", 15],
      "max-lines-per-function": ["error", { max: 120, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
      "max-statements": ["error", 50],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-empty-function": "error",
    },
  },

  // .ts 는 타입을 아는 typescript-eslint 쪽 규칙이 본다(overload · 타입 안의 매개변수 이름을 미사용으로 잡지 않는다)
  {
    files: ["**/*.ts"],
    rules: { "no-unused-vars": "off" },
  },
];
