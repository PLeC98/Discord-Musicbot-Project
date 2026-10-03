import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router/index.js";
import axios from "axios";
import tooltip from "./directives/tooltip.js";
import "./style.css";
import { problemCode } from "./utils/problem.js";
import { loadPronunciations } from "../../src/rules/pronunciations.ts";

axios.defaults.withCredentials = true;

// 오류 안내의 조사(영어 낱말)에 쓰는 발음 사전. 따로 받는 조각이라 화면을 막지 않는다
loadPronunciations();

let csrfToken = null;
let csrfTokenRequest = null;
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfTokenRequest) {
    csrfTokenRequest = axios
      .get("/api/csrf-token")
      .then((response) => {
        csrfToken = response.data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfTokenRequest = null;
      });
  }
  return csrfTokenRequest;
}

axios.interceptors.request.use(async (request) => {
  const method = (request.method || "GET").toUpperCase();
  if (unsafeMethods.has(method)) {
    request.headers["X-CSRF-Token"] = await getCsrfToken();
  }
  return request;
});

axios.interceptors.response.use(undefined, (error) => {
  if (problemCode(error) === "bad-csrf-token") csrfToken = null;
  return Promise.reject(error);
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.directive("tooltip", tooltip);
app.mount("#app");
