// dashboard/src/composables/bot-boot.ts, utils/request.ts: 응답의 기동 표시가 처음 본 것과 달라지면(봇이 다시 켜짐) 새로고침한다.
// 저장하지 않은 편집이 있으면 새로고침하지 않고 버튼이 달린 알림을 띄운다. 한 번만

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "../../../dashboard/node_modules/axios/index.js";
import { noteBoot, _resetBoot } from "../../../dashboard/src/composables/bot-boot.ts";
import { unsaved } from "../../../dashboard/src/composables/unsaved.ts";
import { toasts, dismiss } from "../../../dashboard/src/composables/toasts.ts";
import { installRequests } from "../../../dashboard/src/utils/request.ts";
import { BOOT_HEADER } from "../../../src/dashboard/contract/boot.ts";

beforeEach(() => {
  _resetBoot();
  unsaved.clear();
  for (const one of [...toasts]) dismiss(one.id);
});

test("처음 본 표시와 같으면 아무것도 하지 않고, 달라지면 한 번만 새로고침한다", () => {
  let reloads = 0;
  const reload = () => void reloads++;
  noteBoot("a", reload);
  noteBoot("a", reload);
  assert.equal(reloads, 0);
  noteBoot("b", reload);
  noteBoot("c", reload);
  assert.equal(reloads, 1);
});

test("저장하지 않은 편집이 있으면 새로고침하지 않고 새로고침 버튼이 달린 알림을 띄운다", () => {
  let reloads = 0;
  unsaved.add("update:ytdlp");
  noteBoot("a", () => void reloads++);
  noteBoot("b", () => void reloads++);
  assert.equal(reloads, 0);
  const shown = toasts.find((one) => one.actions.length > 0);
  assert.ok(shown, "알림이 떴다");
  shown.actions[0]?.run?.();
  assert.equal(reloads, 1, "버튼을 누르면 새로고침");
});

test("요청 모듈은 성공, 실패 응답 모두에서 기동 표시를 넘긴다", async () => {
  const seen: string[] = [];
  let fail = false;
  const http = axios.create({
    adapter: async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const response = { data: {}, status: fail ? 500 : 200, statusText: "", headers: { [BOOT_HEADER]: fail ? "two" : "one" }, config } as AxiosResponse;
      if (fail) throw new axios.AxiosError("실패", "ERR_BAD_RESPONSE", config, null, response);
      return response;
    },
  });
  installRequests(http, { onSessionEnd: () => undefined, onReach: () => undefined, onBoot: (id) => seen.push(id) });
  await http.get("/api/x");
  fail = true;
  await http.get("/api/x").catch(() => undefined);
  assert.deepEqual(seen, ["one", "two"]);
});
