// 봇 실행. `pnpm start` · `pnpm run dev`.
// 봇(src/index.ts)을 자식으로 실행하고 대시보드에서 다시 시작하면 다시 실행한다(app/launcher). pm2 · systemd · 도커도 이것을 실행한다.

import childProcess from "node:child_process";
import path from "node:path";
import { launch } from "../src/app/launcher.ts";

launch(path.join(import.meta.dirname, "..", "src", "index.ts"), {
  spawn: (command, args, options) => childProcess.spawn(command, args, options),
  proc: process,
  exit: (code) => process.exit(code),
  say: (line) => console.log(line),
});
