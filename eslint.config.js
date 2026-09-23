"use strict";

// ESLint flat config. 목적은 버그 탐지(미사용 변수·미정의 참조·await 실수 등)
// 코드 모양은 Prettier 담당 - eslint-config-prettier로 스타일 규칙을 전부 끔

const js = require("@eslint/js");
const globals = require("globals");
const pluginVue = require("eslint-plugin-vue");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
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

  // 봇 본체 - Node CommonJS
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: globals.node,
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

  // 봇 쪽 코드의 품질 게이트. 지금의 위반은 eslint-suppressions.json 에 기준선으로 둔다(한 번만 만들고 다시 만들지 않는다).
  // 위반을 줄인 커밋은 `eslint . --prune-suppressions` 로 억제 파일도 같이 줄인다. 새로 쓴 코드는 억제 목록에 못 들어간다.
  // 일부러 비워 둔 catch · 함수는 안에 이유 주석을 적는다(주석이 있으면 빈 것으로 안 본다).
  {
    files: ["src/**/*.js", "commands/**/*.js", "events/**/*.js", "dashboard/server/**/*.js", "index.js", "config.js", "scripts/**/*.js"],
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
];
