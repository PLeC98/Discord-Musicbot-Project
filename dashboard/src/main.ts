import "./style.css";
import { createDashboard } from "./app.ts";
import symbolsFont from "@fontsource-variable/material-symbols-rounded/files/material-symbols-rounded-latin-fill-normal.woff2?url";

// 아이콘 글꼴은 첫 아이콘이 그려질 때에야 받기 시작한다. 그보다 먼저 받아 비어 보이는 시간을 줄인다
const preload = Object.assign(document.createElement("link"), { rel: "preload", as: "font", type: "font/woff2", crossOrigin: "anonymous", href: symbolsFont });
document.head.append(preload);

createDashboard().app.mount("#app");
