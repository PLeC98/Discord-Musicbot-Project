// 로그인 배경(운영자 패널). /api/admin/appearance/login-background. 상태 하나(LoginBackgroundState)를 읽고, 바꾸는 요청들도 그것으로 답한다.
// 올리기는 본문을 그대로 배경 폴더에 흘려 쓴다(고정 상한 없이 남은 저장 공간으로만 막는다). 단계는 login-background/runner 가 돌린다

import express, { type Request, type Response } from "express";
import fs from "node:fs";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { ranBy } from "../ran-by.ts";
import { sendProblem } from "../problem.ts";
import { saveBody } from "../body-to-file.ts";
import { isHttpLink, isYouTubeURL } from "../../rules/links.ts";
import { josa } from "../../rules/josa.ts";
import { formatBytes } from "../../ui/format.ts";
import { parse, BackgroundEditBody, BackgroundEstimateBody, BackgroundLimitsBody, BackgroundLinkBody, BackgroundOptionsBody, BackgroundPositionBody, BackgroundUseBody } from "../request-schemas.ts";
import type { LoginBackgroundItem, LoginBackgroundState } from "../contract/login-background.ts";
import * as store from "../login-background/store.ts";
import * as runner from "../login-background/runner.ts";
import * as encoders from "../login-background/encoders.ts";
import { previewOf } from "../login-background/preview.ts";
import { stripOf } from "../login-background/strip.ts";

/** 올린 파일 이름(보이기만 한다)의 길이 상한 */
const NAME_MAX = 200;

const loginBackgroundRouter = express.Router();
loginBackgroundRouter.use(requireOwner);

/** 기록 줄에 띄울 가장 작은 정지 그림(공개 파일) */
const thumbOf = (one: store.Stored) => (one.media.stills.length ? `/login-background/${one.id}/still-${Math.min(...one.media.stills)}.webp` : null);

function itemOf(one: store.Stored): LoginBackgroundItem {
  const running = runner.isRunning(one.id);
  return {
    id: one.id,
    kind: one.kind,
    from: one.from,
    name: one.name,
    at: one.at,
    usedAt: one.usedAt,
    bytes: one.bytes,
    width: one.width,
    height: one.height,
    duration: one.duration,
    fps: one.fps,
    edit: one.edit,
    position: one.position,
    phase: store.phaseOf(one, running),
    stages: one.stages,
    stage: running ? one.stage : null,
    progress: runner.progressOf(one.id),
    done: one.done,
    resumed: one.resumed,
    shows: store.showsOf(one),
    thumb: thumbOf(one),
    strip: one.strip,
    problem: one.problem,
    // 무거운 초마다의 크기는 편집을 적용하기 전에만
    estimate: one.edit === null && one.estimate ? { ...one.estimate, counting: runner.isCounting(one.id) } : null,
  };
}

function stateOf(): LoginBackgroundState {
  const index = store.loaded();
  return {
    current: index.current,
    previous: store.previousId(),
    shows: store.showsOf(index.current ? store.find(index.current) : null),
    list: index.items.map(itemOf),
    options: index.options,
    limits: index.limits,
    usedBytes: index.items.reduce((sum, one) => sum + one.bytes, 0),
    freeBytes: store.freeBytes(),
    encoders: encoders.encoderList(),
    checking: encoders.isChecking(),
  };
}

const reply = (res: Response) => res.json(stateOf() satisfies LoginBackgroundState);
/** 경로의 배경. 없으면 route-not-found 를 보내고 null */
function itemFor(req: Request<{ id: string }>, res: Response) {
  const one = store.find(req.params.id);
  if (!one) sendProblem(res, "route-not-found");
  return one;
}
/** 바꾼 것을 적고 로그를 남기고 상태로 답한다 */
function changed<P>(req: Request<P>, res: Response, what: string) {
  store.save();
  log.info({ sub: "admin" }, `로그인 배경: ${what}. 실행 ${ranBy(req)}`);
  reply(res);
}

loginBackgroundRouter.get("/", (_req, res) => {
  reply(res);
});

// 파일 그대로(Content-Type 은 종류를 짐작만 한다, 받기 단계가 원본을 읽어 다시 정한다). ?name= 은 보일 이름
loginBackgroundRouter.post("/upload", async (req, res) => {
  const name =
    String(req.query.name ?? "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .slice(0, NAME_MAX) || "file";
  const room = store.room();
  const type = String(req.headers["content-type"] ?? "");
  const id = store.reserve();
  const saved = await saveBody(req, store.sourceOf(id), room);
  if (!saved.ok) {
    fs.rmSync(store.folderOf(id), { recursive: true, force: true });
    if (saved.why === "no-space") return sendProblem(res, "background-no-space", { size: room });
    // 올리던 사람이 끊었다
    if (saved.why === "aborted") log.warn({ sub: "admin" }, `로그인 배경 "${name}"${josa(name, "을")} 받다 끊겼습니다: ${saved.detail}`);
    if (!res.headersSent) sendProblem(res, "bad-request");
    return;
  }
  const one = store.create({ id, kind: type.startsWith("video/") || type === "image/gif" ? "video" : "image", from: "upload", name });
  one.bytes = saved.bytes;
  runner.kick();
  changed(req, res, `"${name}"${josa(name, "을")} 올렸습니다(${formatBytes(saved.bytes)})`);
});

// 링크로 추가. 유튜브는 다운로드 대행(고해상도는 편집을 적용한 뒤), 그 밖은 직접 링크의 그림 · 영상
loginBackgroundRouter.post("/link", (req, res) => {
  const body = parse(BackgroundLinkBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  const url = body.value.url;
  if (!isHttpLink(url)) return sendProblem(res, "bad-request");
  const youtube = isYouTubeURL(url);
  store.create({ kind: youtube ? "video" : "image", from: youtube ? "youtube" : "link", name: url, link: url });
  runner.kick();
  changed(req, res, `링크로 추가했습니다(${url})`);
});

// 편집 창의 미리보기(영상 480p · 그림). 원본과 함께 지우므로 없으면 404. 배경마다 같은 파일이라 오래 캐시한다
loginBackgroundRouter.get("/:id/preview", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  const file = previewOf(one.id);
  if (!file) return sendProblem(res, "route-not-found");
  res.sendFile(file, { headers: { "Cache-Control": "private, max-age=31536000, immutable" } });
});

// 편집 창 시간 막대의 장면 띠(격자 WebP 한 장, 모양은 배경의 strip)
loginBackgroundRouter.get("/:id/strip", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  const file = stripOf(one.id);
  if (!file) return sendProblem(res, "route-not-found");
  res.sendFile(file, { headers: { "Cache-Control": "private, max-age=31536000, immutable" } });
});

// 크기 어림 다시 세기(편집 창에서 크롭을 정했을 때)
loginBackgroundRouter.put("/:id/estimate", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  if (store.phaseOf(one, runner.isRunning(one.id)) !== "editing") return sendProblem(res, "background-not-editable");
  const body = parse(BackgroundEstimateBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  runner.recount(one, body.value.crop, body.value.range);
  reply(res);
});

// 편집 적용(편집을 기다리는 배경에 한 번만). 구간은 영상 길이 안, 그림은 구간 · 썸네일 장면이 없다
loginBackgroundRouter.put("/:id/edit", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  if (store.phaseOf(one, runner.isRunning(one.id)) !== "editing") return sendProblem(res, "background-not-editable");
  const body = parse(BackgroundEditBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  const { crop, range, thumbAt } = body.value;
  const video = one.kind === "video";
  if (video && range && range[1] > one.duration + 0.5) return sendProblem(res, "bad-request");
  one.edit = { crop, range: video ? range : null, thumbAt: video ? thumbAt : null };
  one.appliedAt = Date.now();
  one.estimate = null;
  runner.stopCounting(one.id);
  runner.kick();
  changed(req, res, `"${one.name}" 의 편집을 적용했습니다`);
});

loginBackgroundRouter.put("/:id/position", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  const body = parse(BackgroundPositionBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  one.position = body.value;
  changed(req, res, `"${one.name}" 의 보일 자리를 ${body.value.x}% · ${body.value.y}% 로 바꿨습니다`);
});

// 편집 취소 · 인코딩 취소: 배경을 버리고, 걸려 있던 배경이면 이전 배경으로
loginBackgroundRouter.post("/:id/cancel", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  runner.discard(one.id);
  changed(req, res, `"${one.name}" 만들기를 그만뒀습니다`);
});

loginBackgroundRouter.put("/current", (req, res) => {
  const body = parse(BackgroundUseBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  const one = store.find(body.value.id);
  if (!one) return sendProblem(res, "route-not-found");
  if (!store.isReady(one)) return sendProblem(res, "background-not-ready");
  if (store.loaded().current !== one.id) store.show(one.id);
  changed(req, res, `"${one.name}"${josa(one.name, "으로")} 바꿨습니다`);
});

// 비우기(봇 프로필 그림 배경으로). 기록은 남는다
loginBackgroundRouter.delete("/current", (req, res) => {
  store.show(null);
  changed(req, res, "배경을 비웠습니다");
});

// 기록에서 지우기. 만드는 중이면 취소와 같다
loginBackgroundRouter.delete("/:id", (req, res) => {
  const one = itemFor(req, res);
  if (!one) return;
  runner.discard(one.id);
  changed(req, res, `"${one.name}"${josa(one.name, "을")} 기록에서 지웠습니다`);
});

// 인코더를 다시 시험한다(드라이버를 바꾼 뒤 등). 끝나기를 기다리지 않고 checking 으로 답한다
loginBackgroundRouter.post("/encoders/check", (req, res) => {
  void encoders.recheck();
  changed(req, res, "인코더를 다시 시험합니다");
});

loginBackgroundRouter.put("/options", (req, res) => {
  const body = parse(BackgroundOptionsBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  const options = body.value;
  store.loaded().options = options;
  changed(req, res, `화면 값을 바꿨습니다(흐림 ${options.blur}% · 덮개 ${options.cover}% · 테마 색 ${options.follow ? "켬" : "끔"} · 반복 전환 ${options.seam.kind} ${options.seam.seconds}초)`);
});

// 한도를 바꾸면 바로 지킨다
loginBackgroundRouter.put("/limits", (req, res) => {
  const body = parse(BackgroundLimitsBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  const limits = body.value;
  store.loaded().limits = limits;
  const removed = store.enforceLimits();
  changed(req, res, `한도를 바꿨습니다(보관 ${limits.history}개 · 최대 ${limits.maxBytes ? formatBytes(limits.maxBytes) : "무제한"})${removed.length ? `. 기록에서 지움: ${removed.join(", ")}` : ""}`);
});

export { loginBackgroundRouter };
