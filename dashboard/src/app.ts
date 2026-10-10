// 화면 앱을 만든다(띄우지는 않는다). main.ts 가 띄우고, 개발 도구는 라우트를 더한 뒤 띄운다

import { createApp } from "vue";
import { createPinia } from "pinia";
import axios from "axios";
import App from "./App.vue";
import router from "./router/index.ts";
import tooltip from "./directives/tooltip.ts";
import { installRequests } from "./utils/request.ts";
import { session } from "./composables/session.ts";

function createDashboard() {
  // 다시 로그인하면 세션이 새로 만들어져 토큰도 바뀐다. 옛 토큰은 거절되고 가로채기가 새 토큰으로 다시 보낸다
  installRequests(axios, {
    onSessionEnd: () => (session.ended = true),
    onReach: (ok) => (session.offline = !ok),
  });

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.directive("tooltip", tooltip);
  return { app, router };
}

export { createDashboard };
