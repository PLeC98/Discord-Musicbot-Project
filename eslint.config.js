"use strict";

// ESLint flat config — 목적은 버그 탐지(미사용 변수·미정의 참조·await 실수 등)
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
      // 빈 catch는 이 코드베이스의 의도된 관용구 (best-effort 정리 경로 다수)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // 미사용이라도 _ 접두사와 catch 파라미터는 허용 (API 시그니처 유지용),
      // rest 생략용 구조분해(const { omit, ...rest })도 허용
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // 제어문자 매칭은 이 코드베이스의 정당한 용례 (ANSI 이스케이프 제거, 입력 정규화 방어)
      "no-control-regex": "off",
    },
  },
];
