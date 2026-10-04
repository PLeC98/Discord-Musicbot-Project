// ESLint flat config. 목적은 버그 탐지(미사용 변수·미정의 참조·await 실수 등)
// 코드 모양은 Prettier 담당 - eslint-config-prettier로 스타일 규칙을 전부 끔
// ESLint 가 이 파일을 jiti 로 읽는다(타입은 뿌리 tsconfig 가 본다)

import js from "@eslint/js";
import globals from "globals";
import pluginVue from "eslint-plugin-vue";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import type { Linter } from "eslint";

const config: Linter.Config[] = [
  {
    ignores: [
      "node_modules",
      "vendor", // 설치 스크립트가 받는 외부 도구
      "dashboard/dist", // 빌드 산출물
      "database",
      "cache",
      "notes",
    ],
  },

  js.configs.recommended,

  // 봇과 화면은 TypeScript. 파서와 권장 규칙(타입 정보 없이 도는 것만). 봇 본체 품질 규칙은 아래에서 건다.
  // .vue 의 파서는 아래 Vue 설정이 vue-eslint-parser 로 덮고 <script> 만 TypeScript 파서에 맡긴다
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["**/*.ts", "**/*.vue"] })),
  {
    files: ["**/*.ts"],
    ignores: ["dashboard/src/**"],
    languageOptions: { globals: globals.nodeBuiltin },
  },
  {
    files: ["**/*.ts", "**/*.vue"],
    rules: {
      // 아래 no-unused-vars 와 같은 기준
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },

  // 대시보드 클라이언트 - Vue 3 + 브라우저 (essential = 오류 방지 규칙만, 스타일은 Prettier)
  ...pluginVue.configs["flat/essential"],
  {
    files: ["dashboard/src/**/*.{js,ts,vue}"],
    languageOptions: {
      sourceType: "module",
      globals: globals.browser,
    },
  },
  // .vue 의 <script> 는 TypeScript 파서로 읽는다
  {
    files: ["dashboard/src/**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] } },
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
  // 일부러 비워 둔 catch · 함수는 안에 이유 주석을 적는다(주석이 있으면 빈 것으로 안 본다). 화면 앱에도 같게 건다
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "dashboard/src/**/*.{ts,vue}"],
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

  // 새어 나가는 약속을 막는다. 기다리지 않는 약속은 경계를 지나거나 bestEffort 로(실패를 받는 곳이 있어야 한다). 화면은 void 로 기다리지 않음을 적는다.
  // 타입 정보가 필요해 봇 · 화면 코드에만 건다(시험은 가짜 · 일부러 기다리지 않는 약속이 많다). 화면 파일은 dashboard/tsconfig.json 이 본다
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "dashboard/src/**/*.{ts,vue}"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname, extraFileExtensions: [".vue"] } },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "file", name: "bestEffort", path: "src/infra/best-effort.ts" }] }],
      "@typescript-eslint/no-misused-promises": "error",
    },
  },

  // TypeScript 는 타입을 아는 typescript-eslint 쪽 규칙이 본다(overload · 타입 안의 매개변수 이름을 미사용으로 잡지 않는다)
  {
    files: ["**/*.ts", "**/*.vue"],
    rules: { "no-unused-vars": "off" },
  },
];

export default config;
