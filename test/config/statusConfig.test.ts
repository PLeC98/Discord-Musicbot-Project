// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 상태 문구 설정 — config/status.yaml 과 그것을 읽는 StatusManager.
//
// 이 파일도 주인이 둘이라(손으로 고치는 운영자, 대시보드) 조용히 틀리는 것을 막는 게 핵심이다.
// 특히 날짜·시간 비교가 문자열 비교라, 한 자리로 적으면 "형식 오류"가 아니라 "엉뚱한 날에 걸린다".

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";

import * as yamlStore from "../../src/config/yamlStore.ts";
import * as statusConfig from "../../src/config/status.ts";
import StatusManager from "../../src/ui/botPresence.js";
import { ActivityType } from "discord.js";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-status-"));
const CONFIG = path.join(import.meta.dirname, "..", "..", "config");

before(() => yamlStore._setConfigDir(DIR));
after(() => {
  yamlStore._setConfigDir(CONFIG);
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

const ok = { messages: ["🎵 /play"] };

// ── 검사 ──────────────────────────────────────────────────────────────────

test("예시 파일은 아무 문제가 없다", () => {
  // 새로 설치한 사람이 곧바로 저장이 막히는 일이 없어야 한다
  const data = YAML.parse(fs.readFileSync(path.join(CONFIG, "status.example.yaml"), "utf8"));
  assert.deepEqual(statusConfig.validateStatus(data), []);
});

test("활동 종류 목록은 StatusManager와 같다", () => {
  // configDataLoader가 StatusManager를 require하면 순환이 된다 — 그래서 목록을 따로 들고 있다
  assert.deepEqual(Object.keys(StatusManager.TYPE_MAP), statusConfig.ACTIVITY_TYPES);
});

test("문구는 그냥 적어도 되고, 종류가 필요할 때만 풀어 적는다", () => {
  assert.deepEqual(statusConfig.validateStatus({ messages: ["🎵 /play", { text: "🎮 놀아요", type: "Playing" }] }), []);
});

test("쓸 수 없는 활동 종류는 걸린다", () => {
  // 잘못 적으면 조용히 "듣는 중"이 된다 — 오타가 말을 안 해 주는 종류다
  const problems = statusConfig.validateStatus({ messages: [{ text: "x", type: "playing" }] });
  assert.match(problems.join(" "), /활동 종류/);
});

test("평소 문구가 없으면 걸린다", () => {
  assert.match(statusConfig.validateStatus({ messages: [] }).join(" "), /문구가 하나는/);
  assert.match(statusConfig.validateStatus({ messages: ["  "] }).join(" "), /빈 문구/);
});

test("문구가 128자를 넘으면 걸린다", () => {
  assert.match(statusConfig.validateStatus({ messages: ["가".repeat(129)] }).join(" "), /128자/);
});

test("interval은 10초 미만일 수 없다", () => {
  assert.match(statusConfig.validateStatus({ ...ok, interval: 5 }).join(" "), /10 이상/);
  assert.deepEqual(statusConfig.validateStatus({ ...ok, interval: 10 }), []);
});

test("날짜·시간은 두 자리로 적어야 한다", () => {
  // 비교가 문자열 비교라 "1-5"는 형식만 어긋나는 게 아니라 엉뚱한 날에 걸린다
  const of = (special) => statusConfig.validateStatus({ ...ok, special }).join(" ");

  assert.match(of({ 봄: { date: "3-1 ~ 3-31", messages: ["x"] } }), /두 자리/);
  assert.match(of({ 심야: { time: "2:00 ~ 6:00", messages: ["x"] } }), /두 자리/);
  assert.match(of({ 겨울: { date: "12-01", messages: ["x"] } }), /~ 로 나눠/);
  assert.match(of({ 이상: { date: "13-01 ~ 13-05", messages: ["x"] } }), /두 자리/);

  assert.deepEqual(statusConfig.validateStatus({ ...ok, special: { 봄: { date: "03-01 ~ 03-31", messages: ["x"] } } }), []);
  assert.deepEqual(statusConfig.validateStatus({ ...ok, special: { 심야: { time: "22:00 ~ 06:00", messages: ["x"] } } }), []);
});

test("조건이 하나도 없는 항목은 걸린다", () => {
  // 조건이 없으면 항상 맞아서 그 아래 항목이 전부 죽는다. 범위만 지우다 밟는 함정이다.
  const problems = statusConfig.validateStatus({ ...ok, special: { 아무때나: { messages: ["x"] } } });
  assert.match(problems.join(" "), /하나는 있어야/);
});

test("항목 이름 규칙은 장르와 같다", () => {
  assert.match(statusConfig.validateStatus({ ...ok, special: { 2024: { date: "01-01 ~ 01-02", messages: ["x"] } } }).join(" "), /차례가 어긋납니다/);
  assert.deepEqual(statusConfig.validateStatus({ ...ok, special: { "2024년": { date: "01-01 ~ 01-02", messages: ["x"] } } }), []);
});

// ── 읽기 ──────────────────────────────────────────────────────────────────

test("처음 읽을 때 틀렸으면 문제를 한 줄씩 적어 던진다(기동이 멈춘다)", () => {
  statusConfig._reset();
  fs.writeFileSync(path.join(DIR, "status.yaml"), "interval: 1\nmessages: []\n");
  yamlStore._cache.clear();

  assert.throws(
    () => statusConfig.status(),
    (e) => e.code === "CONFIG_INVALID" && e.message === ["config/status.yaml 을 읽을 수 없습니다:", "   interval은 10 이상이어야 합니다(초).", "   평소 문구: 문구가 하나는 있어야 합니다."].join("\n"),
  );
});

test("돌던 중에 틀리면 던지지 않고 직전에 맞던 설정으로 돈다. 고치면 새 설정이 들어간다", () => {
  // status()는 회전 주기마다 setInterval 안에서 불린다 — 던지면 타이머에서 잡히지 않는 예외가 된다.
  statusConfig._reset();
  const file = path.join(DIR, "status.yaml");
  const write = (text, mtime) => {
    fs.writeFileSync(file, text);
    fs.utimesSync(file, mtime, mtime);
  };
  write("interval: 30\nmessages: [맞는 문구]\n", 1000);
  yamlStore._cache.clear();
  assert.deepEqual(statusConfig.status().messages, ["맞는 문구"]);

  write("interval: 1\nmessages: []\n", 2000);
  const kept = statusConfig.status();
  assert.equal(kept.interval, 30, "틀린 파일은 쓰지 않는다");
  assert.deepEqual(kept.messages, ["맞는 문구"]);

  write("interval: 60\nmessages: [고친 문구]\n", 3000);
  assert.deepEqual(statusConfig.status().messages, ["고친 문구"]);
});

// ── 고르기 ────────────────────────────────────────────────────────────────

// 오늘이 언제인지를 갈아끼워 조건을 시험한다
function managerAt({ date = "06-15", lunar = "05-10", time = "12:00" }) {
  const manager = new StatusManager({});
  manager.today = () => date;
  manager.todayLunar = () => lunar;
  manager.now = () => time;
  return manager;
}

const CONFIG_SAMPLE = {
  messages: ["평소"],
  special: {
    크리스마스: { date: "12-24 ~ 12-26", messages: ["성탄"] },
    심야: { time: "22:00 ~ 06:00", messages: ["밤1", "밤2"] },
    설날: { lunar: "01-01 ~ 01-15", messages: ["설"] },
    겨울: { date: "12-01 ~ 12-31", messages: ["겨울"] },
  },
};

test("맞는 것이 없으면 평소 문구", () => {
  assert.equal(managerAt({}).getCurrentEntry(CONFIG_SAMPLE).text, "평소");
});

test("위에서부터 먼저 맞는 것 하나를 쓴다", () => {
  // 크리스마스(12-24~26)가 겨울(12-01~31)보다 위에 있으므로 이긴다
  assert.equal(managerAt({ date: "12-25" }).getCurrentEntry(CONFIG_SAMPLE).text, "성탄");
  assert.equal(managerAt({ date: "12-10" }).getCurrentEntry(CONFIG_SAMPLE).text, "겨울");
});

test("자정을 걸친 시간대도 맞는다", () => {
  assert.equal(managerAt({ time: "23:30" }).getCurrentEntry(CONFIG_SAMPLE).text, "밤1");
  assert.equal(managerAt({ time: "03:00" }).getCurrentEntry(CONFIG_SAMPLE).text, "밤1");
  assert.equal(managerAt({ time: "12:00" }).getCurrentEntry(CONFIG_SAMPLE).text, "평소");
});

test("음력 조건도 맞는다", () => {
  assert.equal(managerAt({ lunar: "01-03" }).getCurrentEntry(CONFIG_SAMPLE).text, "설");
});

test("조건을 둘 이상 적으면 전부 맞아야 한다", () => {
  const config = { messages: ["평소"], special: { 이브밤: { date: "12-24 ~ 12-24", time: "20:00 ~ 23:59", messages: ["산타"] } } };

  assert.equal(managerAt({ date: "12-24", time: "21:00" }).getCurrentEntry(config).text, "산타");
  assert.equal(managerAt({ date: "12-24", time: "10:00" }).getCurrentEntry(config).text, "평소", "시간이 안 맞으면 안 쓴다");
  assert.equal(managerAt({ date: "12-23", time: "21:00" }).getCurrentEntry(config).text, "평소", "날짜가 안 맞으면 안 쓴다");
});

test("문구는 차례로 돌아간다", () => {
  const manager = managerAt({ time: "23:30" });
  const picked = [0, 1, 2].map((i) => {
    manager.rotationIndex = i;
    return manager.getCurrentEntry(CONFIG_SAMPLE).text;
  });
  assert.deepEqual(picked, ["밤1", "밤2", "밤1"]);
});

test("풀어 적은 문구의 종류가 그대로 온다", () => {
  const config = { messages: [{ text: "놀아요", type: "Playing" }] };
  assert.deepEqual(managerAt({}).getCurrentEntry(config), { text: "놀아요", type: "Playing" });
});

// ── 걸기 ──────────────────────────────────────────────────────────────────

function presenceClient() {
  const set = [];
  return { set, client: { user: { setActivity: (a) => set.push(a) } } };
}

test("문구를 활동으로 건다. 종류를 안 적으면 듣는 중", () => {
  const { set, client } = presenceClient();
  const manager = new StatusManager(client);
  manager.load = () => ({ messages: ["평소", { text: "놀아요", type: "Playing" }] });

  manager.apply();
  manager.rotationIndex = 1;
  manager.apply();
  assert.deepEqual(set, [
    { name: "평소", type: ActivityType.Listening },
    { name: "놀아요", type: ActivityType.Playing },
  ]);

  // 로그인 전이거나 고를 문구가 없으면 건드리지 않는다
  const loggedOut = new StatusManager({});
  loggedOut.load = () => ({ messages: ["x"] });
  loggedOut.apply();
  manager.load = () => ({ messages: [] });
  manager.apply();
  assert.equal(set.length, 2);
});

test("간격마다 다음 문구로 돌리고, 간격은 10초보다 짧아지지 않는다. stop 이 멈춘다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { set, client } = presenceClient();
  const manager = new StatusManager(client);
  manager.load = () => ({ interval: 3, messages: ["하나", "둘"] });

  manager.start();
  assert.deepEqual(
    set.map((a) => a.name),
    ["하나"],
    "시작하자마자 건다",
  );
  t.mock.timers.tick(9_999);
  assert.equal(set.length, 1, "3초로 적어도 10초");
  t.mock.timers.tick(1);
  assert.deepEqual(
    set.map((a) => a.name),
    ["하나", "둘"],
  );

  manager.stop();
  t.mock.timers.tick(60_000);
  assert.equal(set.length, 2);
  manager.stop(); // 두 번 불러도 된다
});

test("오늘 · 음력 오늘 · 지금은 MM-DD · HH:MM 모양", () => {
  const manager = new StatusManager({});
  assert.match(manager.today(), /^\d{2}-\d{2}$/);
  assert.match(manager.todayLunar(), /^\d{2}-\d{2}$/);
  assert.match(manager.now(), /^\d{2}:\d{2}$/);
});

test("load 는 설정 로더의 status() 를 부른다", () => {
  assert.equal(new StatusManager({}).load(), statusConfig.status());
});
