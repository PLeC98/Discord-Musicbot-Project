import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router/index.ts";
import axios from "axios";
import tooltip from "./directives/tooltip.ts";
import "./style.css";
import { installRequests } from "./utils/request.ts";
import { session } from "./composables/session.ts";

// 다시 로그인하면 세션이 새로 만들어져 토큰도 바뀐다. 옛 토큰은 거절되고 가로채기가 새 토큰으로 다시 보낸다
installRequests(axios, {
  onSessionEnd: () => (session.ended = true),
  onReach: (ok) => (session.offline = !ok),
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.directive("tooltip", tooltip);
app.mount("#app");
