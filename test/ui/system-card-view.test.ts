// src/ui/system-card/view.ts: /system 메시지의 모양(제목 섹션, 이미지 둘 또는 한 줄, 구분선, 갱신, 새로고침)

import { test } from "node:test";
import assert from "node:assert/strict";
import { systemView, type SystemView } from "../../src/ui/system-card/view.ts";
import { textOf, thumbnailOf } from "../helpers/cv2.ts";
import { withConfig } from "../helpers/config.ts";
import { textFor } from "../../src/ui/text/index.ts";
const KO = textFor("ko");

const base: Omit<SystemView, "images"> = { avatar: "https://avatar.test/a.png", versions: { bot: "0.9.0", ytdlp: "2026.11.01", bgutil: null }, updatedAt: 1_800_000_000 };
const json = (v: ReturnType<typeof systemView>) => JSON.stringify(v.view.toJSON());

test("이미지가 있으면 첨부 두 개를 갤러리 두 개로 단다(이미지 설명 포함). 버전 줄은 없는 값을 뺀다", () => {
  const v = systemView(KO, { ...base, images: { top: Buffer.from("a"), bottom: Buffer.from("b") } });
  assert.deepEqual(
    v.files.map((f) => f.name),
    ["system.png", "history.png"],
  );
  const out = json(v);
  assert.ok(out.includes('"url":"attachment://system.png"') && out.includes('"url":"attachment://history.png"'));
  assert.ok(out.includes('"description":"상태, CPU, heap 메모리, 저장공간, 업타임, 현황"'));
  const payload = { components: [v.view] };
  assert.match(textOf(payload), /^### 🖥️ 시스템 상태\n-# 봇 v0\.9\.0 · yt-dlp 2026\.11\.01\n-# 갱신: <t:1800000000:f>$/);
  assert.equal(thumbnailOf(payload), "https://avatar.test/a.png");
  assert.equal(out.includes('"disabled":true'), false, "새로고침을 누를 수 있다");
});

test("그리는 동안은 한 줄과 비활성화된 새로고침 버튼, 그리지 못하면 한 줄과 대시보드 안내. 둘 다 첨부 없음", () => {
  const drawing = systemView(KO, { ...base, images: "drawing" });
  assert.deepEqual(drawing.files, []);
  assert.ok(textOf({ components: [drawing.view] }).includes("상태 이미지를 그리는 중이에요"));
  assert.ok(json(drawing).includes('"disabled":true'));

  const failed = systemView(KO, { ...base, avatar: null, images: "failed" });
  assert.deepEqual(failed.files, []);
  assert.ok(textOf({ components: [failed.view] }).includes("상태 이미지를 그리지 못했어요. 같은 내용은 대시보드의 봇 상태 탭에서 볼 수 있어요"));
  assert.equal(thumbnailOf({ components: [failed.view] }), null, "프로필 이미지가 없으면 제목만");
});

test("새로고침 옆에 운영자 패널의 봇 상태 탭 링크. 대시보드 주소가 이 기기에서만 열리면 링크가 없다", () => {
  const linkOf = (url: string) => withConfig({ dashboard: { url } }, () => [...json(systemView(KO, { ...base, images: "drawing" })).matchAll(/"url":"(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => new URL(u).host !== "avatar.test"));
  assert.deepEqual(linkOf("https://music.example.com"), ["https://music.example.com/admin?tab=status"]);
  assert.deepEqual(linkOf("https://example.com/bot/"), ["https://example.com/bot/admin?tab=status"], "하위 경로에 둔 대시보드");
  assert.deepEqual(linkOf("http://localhost:33333"), []);
  assert.ok(withConfig({ dashboard: { url: "https://music.example.com" } }, () => json(systemView(KO, { ...base, images: "drawing" }))).includes('"label":"운영자 패널"'));
});
