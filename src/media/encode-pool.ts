// 재생 인코딩 워커 풀. 출력(media/opus-output)마다 세션을 열어 주고, 세션이 보낸 PCM 프레임을 워커(media/encode-worker)가 Opus 패킷으로 돌려준다.
//
// 세션이 인코더 자리를 든다. 워커가 죽거나 멈추면 세션을 다른 워커의 새 인코더에 옮겨 붙이고, 답을 못 받은 프레임을 다시 보낸다. 출력은 모른다.
// 받기는 출력의 read() 안에서 부르는 drain()(동기)이 먼저다. message 이벤트는 voice 가 읽지 않을 때(처음 · 일시정지)의 예비 길이다.
// 워커가 늦어지면 먼저 워커를 늘리고, 늘릴 수 없으면 그 워커의 미리 만드는 깊이(depth)를 올린다. 워커는 줄이지 않는다.
// import 만으로는 워커를 띄우지 않는다. 기동 때 start() 가 첫 워커를 띄운다.

import os from "os";
import fs from "fs";
import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from "worker_threads";
import logger from "../infra/log/logger.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import type { FromWorker, ToWorker } from "./encode-worker.ts";
const log = logger.child({ category: "player" });

const FRAME_MS = 20;
const START_DEPTH = 2;
const MAX_DEPTH = 8;
// 워커 하나가 rss 25 ~ 30MB 라 코어 수만큼 늘리지 않는다. availableParallelism 이 CPU quota 를 못 보는 컨테이너도 막는다
const MAX_WORKERS = 8;
const START_TIMEOUT_MS = 10_000;
// 가장 오래된 답을 이만큼 못 받으면 멈춘 워커로 보고 내린다. voice 의 한도(10초)보다 훨씬 짧게
const STALL_MS = 1000;
const STALL_CHECK_MS = 250;
const TICK_MS = 1000;
const CALIBRATE_FRAMES = 200;
// 기동 때 잰 프레임당 시간으로 워커 수를 미리 정할 때, 워커 하나를 이만큼만 채운다(주기의 여유)
const TARGET_BUSY = 0.5;
// 최근 이만큼 안에 프레임을 보낸 세션만 부하로 센다(일시정지한 세션은 비용이 없다)
const ACTIVE_MS = 1000;
// 깊이를 내리기 전에 여유가 이어져야 하는 틱 수(3분)와 분당 바꾸는 횟수 상한
const CALM_TICKS = 180;
const DEPTH_CHANGES_PER_MIN = 4;
const SLOW_CALM_TICKS = 10;
// 60초 안에 3번 죽으면 새 워커를 늦춘다. 같은 세션이 2번 죽음을 겪으면 그 세션만 실패시킨다(입력 하나가 워커를 잇달아 죽이는 경우)
const DEATH_WINDOW_MS = 60_000;
const DEATHS_TO_BACKOFF = 3;
const BACKOFF_MS = [60_000, 300_000, 1_800_000];
const BACKOFF_RESET_MS = 1_800_000;
const POISON_DEATHS = 2;

type SessionHooks = { onPacket(packet: Buffer): void; onError(error: Error): void };

/** 출력 하나의 인코더 자리. 프레임은 보낸 뒤 고치지 않는다(워커를 옮길 때 다시 보낸다) */
type EncodeSession = {
  /** 미리 보내 둘 프레임 수(보낸 것 + 받아 둔 패킷). 바뀌면 다음 보내기부터 따른다 */
  readonly depth: number;
  send(frame: Buffer, gain: number): void;
  /** 읽을 때 부르는 동기 수신. 와 있는 답을 이 자리에서 받는다 */
  drain(): void;
  /** 읽을 때 보낸 것은 있는데 받은 패킷이 없었다(워커가 늦다) */
  late(): void;
  free(): void;
};

type Sent = { seq: number; frame: Buffer; gain: number; sentAt: number };
type Load = Extract<FromWorker, { type: "load" }>;
type Slot = { id: number; entry: Entry | null };

type Entry = {
  n: number;
  thread: Worker;
  port: MessagePort;
  ids: Set<number>;
  depth: number;
  rtt: number[];
  // 지난 틱의 응답 p99(ms). 배정할 때 쓴다
  lastP99: number;
  late: number;
  load: Load | null;
  calm: number;
  depthChanges: number[];
  gone: boolean;
};

const now = () => performance.timeOrigin + performance.now();

class Session implements EncodeSession {
  readonly sent: Sent[] = [];
  readonly deaths: number[] = [];
  lastSend = now();
  freed = false;
  #seq = 0;

  readonly pool: EncodePool;
  readonly hooks: SessionHooks;
  readonly slot: Slot;

  constructor(pool: EncodePool, hooks: SessionHooks, slot: Slot) {
    this.pool = pool;
    this.hooks = hooks;
    this.slot = slot;
  }

  get depth() {
    return this.slot.entry?.depth ?? START_DEPTH;
  }

  send(frame: Buffer, gain: number) {
    if (this.freed) return;
    const item = { seq: this.#seq++, frame, gain, sentAt: 0 };
    this.sent.push(item);
    this.lastSend = now();
    if (this.slot.entry) post(this.slot.entry, this.slot.id, item);
  }

  drain() {
    if (this.slot.entry) this.pool.drain(this.slot.entry);
  }

  late() {
    if (this.slot.entry) this.slot.entry.late++;
  }

  free() {
    this.pool.release(this);
  }
}

function post(entry: Entry, id: number, item: Sent) {
  item.sentAt = now();
  // 보낸 프레임은 옮겨 붙일 때 다시 보내야 하므로 사본을 넘긴다(넘긴 ArrayBuffer 는 이쪽에서 비워진다)
  const pcm = item.frame.buffer.slice(item.frame.byteOffset, item.frame.byteOffset + item.frame.byteLength) as ArrayBuffer;
  const message: ToWorker = { type: "frame", id, seq: item.seq, gain: item.gain, pcm };
  entry.thread.postMessage(message, [pcm]);
}

const control = (entry: Entry, message: ToWorker) => entry.thread.postMessage(message);

/** 워커 수 상한: 남는 코어 수(하나는 메인 몫), CPU quota 가 있으면 그 안, 최소 1 */
function workerLimit() {
  const quota = cgroupCpus();
  const cores = Math.min(os.availableParallelism(), quota ?? Infinity);
  return { max: Math.min(Math.max(1, Math.floor(cores) - 1), MAX_WORKERS), quota };
}

// Linux cgroup v2 의 CPU quota(코어 수). 없거나 못 읽으면 null
function cgroupCpus(): number | null {
  if (process.platform !== "linux") return null;
  try {
    const [quota, period] = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    if (!quota || quota === "max" || !period) return null;
    const cpus = Number(quota) / Number(period);
    return Number.isFinite(cpus) && cpus > 0 ? cpus : null;
  } catch {
    return null;
  }
}

type DepthAction = "grow" | "deepen" | "slow" | "shallow" | null;

/**
 * 워커 하나의 지난 틱으로 정한다. 보낸 프레임은 depth 번째 뒤 읽기에서 쓰이므로 답이 (depth − 1) × 20ms 안에 와야 한다.
 * 그 8할을 넘으면 늘릴 수 있을 때 워커를 늘리고(CPU 를 뺏기는 중이면 늘려도 경쟁만 커진다), 아니면 깊이를 올리고, 상한이면 늦다고 알린다
 */
function decideDepth(s: { rttP99: number; depth: number; canGrow: boolean; contended: boolean; calm: number }): DepthAction {
  if (s.rttP99 > (s.depth - 1) * FRAME_MS * 0.8) {
    if (s.canGrow && !s.contended) return "grow";
    return s.depth < MAX_DEPTH ? "deepen" : "slow";
  }
  if (s.depth > START_DEPTH && s.calm >= CALM_TICKS) return "shallow";
  return null;
}

// 내릴 만큼 여유가 있는 틱인가(한 단계 낮은 깊이의 문턱보다도 빠르다)
const isCalm = (rttP99: number, depth: number) => rttP99 < (depth - 2) * FRAME_MS * 0.8;

function p99(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
}

// 워커가 CPU 를 기다리느라 늦는가: 인코딩에 걸린 벽시계 시간보다 실제로 쓴 CPU 시간이 훨씬 적다
const contendedOf = (load: Load | null) => !!load && load.busyUs > 200_000 && load.cpuUs < load.busyUs * 0.6;

type PoolOptions = { workerUrl?: URL; maxWorkers?: number; stallMs?: number; calibrateFrames?: number };

class EncodePool {
  readonly #url: URL;
  readonly #stallMs: number;
  readonly #calibrateFrames: number;
  #max: number | null;
  #quota: number | null = null;
  #workers: Entry[] = [];
  #spawning = 0;
  #lastN = 0;
  #lastId = 0;
  #frameUs = 0;
  #libopusVersion: string | null = null;
  readonly #sessions = new Map<number, WeakRef<Session>>();
  // 옮겨 갈 워커를 기다리는 세션(워커가 뜨는 중)
  readonly #homeless = new Set<number>();
  #deaths: number[] = [];
  #backoffUntil = 0;
  #backoffLevel = 0;
  #lastDeath = 0;
  #slowSince = 0;
  #slowLate = 0;
  #slowCalm = 0;
  #timers: NodeJS.Timeout[] = [];
  #closing = false;
  #stats = { deaths: 0, late: 0 };

  // 해제하지 않은 채 GC 된 세션의 인코더를 워커에서 해제한다. 여기 닿았다면 리소스를 정리하지 않는 경로가 있다
  readonly #unreleased = new FinalizationRegistry<Slot>((slot) => {
    this.#sessions.delete(slot.id);
    this.#homeless.delete(slot.id);
    const entry = slot.entry;
    if (entry && !entry.gone) {
      entry.ids.delete(slot.id);
      control(entry, { type: "close", id: slot.id });
    }
    log.warn("정리되지 않은 재생 출력의 인코더를 GC 가 해제했습니다. 리소스를 destroy 하지 않는 경로가 있습니다");
  });

  constructor({ workerUrl, maxWorkers, stallMs, calibrateFrames }: PoolOptions = {}) {
    this.#url = workerUrl ?? new URL("./encode-worker.ts", import.meta.url);
    this.#max = maxWorkers ?? null;
    this.#stallMs = stallMs ?? STALL_MS;
    this.#calibrateFrames = calibrateFrames ?? CALIBRATE_FRAMES;
  }

  /** 첫 워커를 띄우고 WASM 을 불러 둔다. 기동 때 한 번 */
  async start() {
    if (!this.#workers.length) this.#adopt(await this.#spawn());
    return { libopusVersion: this.#libopusVersion ?? "", workers: this.#workers.length, max: this.#limit(), quota: this.#quota };
  }

  /** 새 재생을 받을 수 있는가. 못 받으면 ffmpeg 를 띄우기 전에 거절한다 */
  available() {
    return !this.#closing && (this.#workers.length > 0 || this.#mayGrow());
  }

  open(hooks: SessionHooks): EncodeSession {
    const slot: Slot = { id: 0, entry: null };
    const session = new Session(this, hooks, slot);
    this.#unreleased.register(session, slot, session);
    this.#move(session);
    this.#growForLoad();
    return session;
  }

  /** 이 워커의 포트에 와 있는 답을 모두 받는다. 출력마다 받는 도중 오류는 그 출력에서 그친다 */
  drain(entry: Entry) {
    for (let m = receiveMessageOnPort(entry.port); m; m = receiveMessageOnPort(entry.port)) this.#receive(entry, m.message as FromWorker);
  }

  release(session: Session) {
    if (session.freed) return;
    session.freed = true;
    session.sent.length = 0;
    this.#unreleased.unregister(session);
    this.#unbind(session);
  }

  /** 상태 탭 */
  stats() {
    return {
      max: this.#limit(),
      quota: this.#quota,
      sessions: this.#sessions.size,
      deaths: this.#stats.deaths,
      late: this.#stats.late,
      workers: this.#workers.map((e) => ({ n: e.n, streams: e.ids.size, depth: e.depth, cpuPct: e.load ? Math.round(e.load.cpuUs / 10_000) : null })),
    };
  }

  /** 워커를 모두 내린다. 정상 종료에서는 부르지 않는다(프로세스 종료가 스레드를 함께 내린다) */
  async close() {
    this.#closing = true;
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
    const workers = this.#workers;
    this.#workers = [];
    for (const entry of workers) entry.gone = true;
    await Promise.all(workers.map((e) => e.thread.terminate()));
  }

  #limit() {
    if (this.#max === null) {
      const { max, quota } = workerLimit();
      this.#max = max;
      this.#quota = quota;
    }
    return this.#max;
  }

  #mayGrow() {
    return !this.#closing && this.#workers.length + this.#spawning < this.#limit() && now() >= this.#backoffUntil;
  }

  // 워커 하나를 띄워 준비될 때까지 기다린다. 뜨다 죽거나 시간을 넘기면 실패
  #spawn(): Promise<Entry> {
    this.#spawning++;
    const thread = new Worker(this.#url);
    const { port1, port2 } = new MessageChannel();
    const entry: Entry = { n: ++this.#lastN, thread, port: port1, ids: new Set(), depth: START_DEPTH, rtt: [], lastP99: 0, late: 0, load: null, calm: 0, depthChanges: [], gone: false };
    return new Promise<Entry>((resolve, reject) => {
      let ready = false;
      const fail = (why: string) => {
        if (ready) return this.#died(entry, why);
        ready = true;
        clearTimeout(timer);
        entry.gone = true;
        port1.close();
        void thread.terminate();
        reject(new Error(`인코딩 워커를 띄우지 못했습니다: ${why}`));
      };
      const timer = setTimeout(() => fail(`${START_TIMEOUT_MS / 1000}초 안에 준비되지 않음`), START_TIMEOUT_MS);
      port1.on("message", (m: FromWorker) => {
        if (m.type !== "ready") return this.#receive(entry, m);
        ready = true;
        clearTimeout(timer);
        this.#libopusVersion ??= m.libopusVersion;
        if (m.frameUs > 0) this.#frameUs = m.frameUs;
        resolve(entry);
      });
      thread.on("error", (error) => fail(messageOf(error)));
      thread.on("exit", (code) => fail(`스레드가 끝남(코드 ${code})`));
      // 봇이 끝날 때 붙잡지 않는다. message 를 들으면 다시 붙잡으므로 들은 뒤에 푼다
      port1.unref();
      thread.unref();
      const init: ToWorker = { type: "init", port: port2, calibrateFrames: this.#workers.length ? 0 : this.#calibrateFrames };
      thread.postMessage(init, [port2]);
    }).finally(() => this.#spawning--);
  }

  // 준비된 워커를 풀에 넣고, 기다리던 세션을 붙인다
  #adopt(entry: Entry) {
    // 준비된 뒤 풀에 넣기 전에 죽었다(죽음은 이미 셌다)
    if (entry.gone) return this.#rehome();
    this.#workers.push(entry);
    if (this.#workers.length > 1) log.info(`재생 인코딩 워커를 늘렸습니다(${this.#workers.length}개, 상한 ${this.#limit()})`);
    if (!this.#timers.length && !this.#closing) {
      this.#timers.push(setInterval(() => this.#checkStalls(), STALL_CHECK_MS).unref(), setInterval(() => this.#tick(), TICK_MS).unref());
    }
    for (const id of this.#homeless) {
      const session = this.#sessions.get(id)?.deref();
      this.#homeless.delete(id);
      if (session && !session.freed) this.#attach(session, entry);
    }
  }

  #grow() {
    if (!this.#mayGrow()) return false;
    this.#spawn().then(
      (entry) => (this.#closing ? void entry.thread.terminate() : this.#adopt(entry)),
      (error: unknown) => {
        log.warn(messageOf(error));
        this.#noteDeath();
        this.#rehome();
      },
    );
    return true;
  }

  // 기동 때 잰 프레임당 시간으로 지금 활성 세션에 필요한 워커 수를 어림해 모자라면 늘린다(세션 복원 몰림)
  #growForLoad() {
    if (!this.#frameUs || this.#spawning) return;
    const active = this.#workers.reduce((sum, e) => sum + this.#activeOf(e), 0);
    const wanted = Math.ceil((active * this.#frameUs) / (FRAME_MS * 1000 * TARGET_BUSY));
    if (wanted > this.#workers.length) this.#grow();
  }

  #activeOf(entry: Entry) {
    const since = now() - ACTIVE_MS;
    let active = 0;
    for (const id of entry.ids) if ((this.#sessions.get(id)?.deref()?.lastSend ?? 0) >= since) active++;
    return active;
  }

  // 가장 한가한 워커: 활성 세션이 적은 쪽, 같으면 지난 틱의 응답이 빠른 쪽
  #pick(): Entry | null {
    let best: Entry | null = null;
    let bestScore = Infinity;
    for (const entry of this.#workers) {
      const score = this.#activeOf(entry) * 1000 + Math.min(entry.lastP99, 999);
      if (score < bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best;
  }

  // 세션을 지금 가장 한가한 워커에 붙인다. 워커가 없으면 띄우는 동안 기다리고, 띄울 수도 없으면 실패
  #move(session: Session) {
    this.#unbind(session);
    const target = this.#pick();
    if (target) return this.#attach(session, target);
    this.#homeless.add(this.#rename(session));
    if (this.#spawning || this.#grow()) return;
    this.#homeless.delete(session.slot.id);
    // open() 안에서 바로 실패를 알리면 출력이 아직 만들어지는 중이다
    queueMicrotask(() => this.#fail(session, unavailable()));
  }

  // 붙일 때마다 새 id 를 쓴다. 떠난 워커의 늦은 답이 같은 id 로 다시 들어오지 않게
  #rename(session: Session) {
    this.#sessions.delete(session.slot.id);
    const id = ++this.#lastId;
    session.slot.id = id;
    this.#sessions.set(id, new WeakRef(session));
    return id;
  }

  #attach(session: Session, entry: Entry) {
    const id = this.#rename(session);
    session.slot.entry = entry;
    entry.ids.add(id);
    control(entry, { type: "open", id });
    for (const item of session.sent) post(entry, id, item);
  }

  #unbind(session: Session) {
    const { id, entry } = session.slot;
    this.#homeless.delete(id);
    if (session.freed) this.#sessions.delete(id);
    session.slot.entry = null;
    if (!entry) return;
    entry.ids.delete(id);
    if (!entry.gone) control(entry, { type: "close", id });
  }

  #receive(entry: Entry, m: FromWorker) {
    if (m.type === "load") {
      entry.load = m;
      return;
    }
    if (m.type !== "packet" && m.type !== "error") return;
    if (entry.gone) return;
    const found = this.#sessions.get(m.id)?.deref();
    // 없으면 해제했거나 다른 워커로 옮긴 세션의 늦은 답이다. 해제할 때마다 생기므로 남기지 않는다
    const session = found && !found.freed && found.slot.entry === entry ? found : null;
    if (m.type === "error" && m.fatal) {
      // 어느 프레임에서 났는지 안다. 그 세션은 다시 보내지 않고 실패시키고, 이 죽음은 잇단 죽음(백오프)에 세지 않는다
      if (session) this.#fail(session, new Error(`인코딩 중 WASM 오류: ${m.message}`));
      return this.#died(entry, `WASM 오류로 내렸습니다(${m.message})`, { known: !!session });
    }
    if (session) this.#answer(entry, session, m);
  }

  // 세션의 가장 오래된 프레임에 온 답
  #answer(entry: Entry, session: Session, m: Extract<FromWorker, { type: "packet" | "error" }>) {
    const head = session.sent[0];
    if (!head || head.seq !== m.seq) return this.#fail(session, new Error(`인코딩 답의 순서가 어긋났습니다(기다린 ${head?.seq ?? "없음"}, 받은 ${m.seq})`));
    session.sent.shift();
    // 메인이 받기를 미룬 시간은 빼고 워커가 걸린 시간을 본다. 스레드마다 시계 기준이 조금 다를 수 있어 받은 때를 넘지 않게 한다
    const received = now();
    entry.rtt.push(Math.max(0, Math.min(received, m.doneAt) - head.sentAt));
    if (m.type === "error") return this.#fail(session, new Error(m.message));
    try {
      session.hooks.onPacket(Buffer.from(m.packet));
    } catch (error) {
      this.#fail(session, error instanceof Error ? error : new Error(String(error)));
    }
  }

  #fail(session: Session, error: Error) {
    if (session.freed) return;
    this.release(session);
    try {
      session.hooks.onError(error);
    } catch (thrown) {
      log.debug(`재생 출력이 인코딩 오류를 받다 실패했습니다: ${messageOf(thrown)}`);
    }
  }

  // 멈춘 워커를 찾는다. 메인 루프가 밀렸을 수도 있으니 와 있는 답부터 받는다
  #checkStalls() {
    const at = now();
    for (const entry of this.#workers.slice()) {
      this.drain(entry);
      if (entry.gone) continue;
      let oldest = Infinity;
      for (const id of entry.ids) {
        const head = this.#sessions.get(id)?.deref()?.sent[0];
        if (head?.sentAt && head.sentAt < oldest) oldest = head.sentAt;
      }
      if (at - oldest > this.#stallMs) this.#died(entry, `${(this.#stallMs / 1000).toFixed(1)}초 넘게 답이 없어 내렸습니다`);
    }
  }

  // 워커가 죽었거나 내렸다. 맡던 세션은 다른 워커로 옮긴다
  // known: 원인 세션을 이미 실패시켰다. 남은 세션에는 죽음을 세지 않는다
  #died(entry: Entry, why: string, { known = false } = {}) {
    if (entry.gone) return;
    entry.gone = true;
    this.#workers = this.#workers.filter((e) => e !== entry);
    entry.port.close();
    void entry.thread.terminate();
    if (this.#closing) return;
    const sessions = [...entry.ids].map((id) => this.#sessions.get(id)?.deref()).filter((s): s is Session => !!s && !s.freed);
    const at = now();
    // 이 세션이 붙어 있던 워커가 잇달아 죽었다: 그 입력이 워커를 죽이는 것으로 보고 그 세션만 실패시킨다
    const poisoned = sessions.filter((session) => {
      if (known) return false;
      session.deaths.splice(0, session.deaths.length, ...session.deaths.filter((t) => at - t < DEATH_WINDOW_MS), at);
      return session.deaths.length >= POISON_DEATHS;
    });
    const moved = sessions.length - poisoned.length;
    const what: string[] = [];
    if (moved || !poisoned.length) what.push(`맡던 스트림 ${moved}개를 다른 워커로 옮깁니다`);
    if (poisoned.length) what.push(`스트림 ${poisoned.length}개는 붙어 있던 워커가 잇달아 죽어 실패시킵니다`);
    log.warn(`재생 인코딩 워커 ${entry.n}: ${why}. ${what.join(". ")}`);
    this.#stats.deaths++;
    if (!known) this.#noteDeath();
    for (const session of sessions) {
      if (poisoned.includes(session)) this.#fail(session, new Error("이 스트림을 맡은 인코딩 워커가 잇달아 죽었습니다"));
      else this.#move(session);
    }
  }

  // 죽음을 센다. 잇달아 죽으면 새 워커를 늦춘다
  #noteDeath() {
    const at = now();
    if (at - this.#lastDeath > BACKOFF_RESET_MS) this.#backoffLevel = 0;
    this.#lastDeath = at;
    this.#deaths = [...this.#deaths.filter((t) => at - t < DEATH_WINDOW_MS), at];
    if (this.#deaths.length < DEATHS_TO_BACKOFF) return;
    const wait = BACKOFF_MS[Math.min(this.#backoffLevel, BACKOFF_MS.length - 1)] ?? 0;
    this.#backoffLevel++;
    this.#deaths = [];
    this.#backoffUntil = at + wait;
    const alive = this.#workers.length;
    log.error(`재생 인코딩 워커가 ${DEATH_WINDOW_MS / 1000}초 안에 ${DEATHS_TO_BACKOFF}번 죽어 ${wait / 60_000}분 동안 새 워커를 띄우지 않습니다(남은 워커 ${alive}개)` + (alive ? "" : ". 그동안 새 재생은 실패합니다"));
  }

  // 워커를 띄우지 못했을 때 기다리던 세션: 남은 워커가 있으면 그리로, 없으면 실패
  #rehome() {
    for (const id of [...this.#homeless]) {
      const session = this.#sessions.get(id)?.deref();
      this.#homeless.delete(id);
      if (!session || session.freed) continue;
      const target = this.#pick();
      if (target) this.#attach(session, target);
      else this.#fail(session, unavailable());
    }
  }

  // 1초마다 워커별로 응답 시간을 보고 늘리기 · 깊이를 정한다
  #tick() {
    const at = now();
    let slow: Entry | null = null;
    for (const entry of this.#workers.slice()) {
      const rttP99 = p99(entry.rtt);
      const late = entry.late;
      entry.lastP99 = rttP99;
      entry.rtt = [];
      entry.late = 0;
      this.#stats.late += late;
      entry.calm = isCalm(rttP99, entry.depth) ? entry.calm + 1 : 0;
      entry.depthChanges = entry.depthChanges.filter((t) => at - t < 60_000);
      const action = decideDepth({ rttP99, depth: entry.depth, canGrow: this.#mayGrow() && !this.#spawning, contended: contendedOf(entry.load), calm: entry.calm });
      if (action === "grow") this.#growFrom(entry);
      else if (action === "slow" && late > 0) slow = entry;
      // 띄우는 중인 워커가 있으면 깊이를 올리지 않고 기다린다(뜨면 스트림을 나눠 받는다)
      else if (action === "deepen" && this.#spawning) continue;
      else if ((action === "deepen" || action === "shallow") && entry.depthChanges.length < DEPTH_CHANGES_PER_MIN) {
        entry.depth += action === "deepen" ? 1 : -1;
        entry.depthChanges.push(at);
        entry.calm = 0;
        log.debug(`재생 인코딩 워커 ${entry.n}: 미리 만드는 깊이 ${entry.depth}(응답 p99 ${rttP99.toFixed(1)}ms)`);
      }
      if (slow === entry) this.#slowLate += late;
    }
    this.#noteSlow(slow);
  }

  // 워커를 하나 늘리고, 늦은 워커의 활성 세션 절반을 새 워커로 옮긴다
  #growFrom(entry: Entry) {
    if (!this.#mayGrow()) return;
    this.#spawn().then(
      (fresh) => {
        if (this.#closing) return void fresh.thread.terminate();
        this.#adopt(fresh);
        const since = now() - ACTIVE_MS;
        const active = [...entry.ids].map((id) => this.#sessions.get(id)?.deref()).filter((s): s is Session => !!s && !s.freed && s.lastSend >= since);
        for (const session of active.slice(0, Math.floor(active.length / 2))) {
          this.#unbind(session);
          this.#attach(session, fresh);
        }
        log.debug(`재생 인코딩 워커 ${entry.n} 의 스트림 ${Math.floor(active.length / 2)}개를 워커 ${fresh.n} 로 옮겼습니다`);
      },
      (error: unknown) => {
        log.warn(messageOf(error));
        this.#noteDeath();
      },
    );
  }

  // 깊이 상한에서도 늦은 프레임이 이어지면 처음 한 줄 warn, 10초 동안 늦지 않으면 풀렸다고 한 줄 info
  #noteSlow(slow: Entry | null) {
    if (slow) this.#slowCalm = 0;
    else if (this.#slowSince) this.#slowCalm++;
    if (slow && !this.#slowSince) {
      this.#slowSince = now();
      const streams = this.#workers.reduce((sum, e) => sum + e.ids.size, 0);
      const cpu = slow.load ? `${Math.round(slow.load.cpuUs / 10_000)}%` : "알 수 없음";
      log.warn(`재생 인코딩이 늦습니다(워커 ${this.#workers.length}개 · 상한 ${this.#limit()}, 스트림 ${streams}개, 늦은 워커의 CPU ${cpu}). 늦은 만큼 소리가 끊깁니다`);
    } else if (this.#slowSince && this.#slowCalm >= SLOW_CALM_TICKS) {
      log.info(`재생 인코딩 늦음이 풀렸습니다(${Math.round((now() - this.#slowSince) / 1000)}초 동안 늦은 프레임 ${this.#slowLate}개)`);
      this.#slowSince = 0;
      this.#slowLate = 0;
    }
  }
}

const unavailable = () => codedError("encoder-unavailable", "쓸 수 있는 재생 인코딩 워커가 없습니다");

const encodePool = new EncodePool();

export { encodePool, EncodePool, decideDepth, workerLimit, START_DEPTH, MAX_DEPTH };
export type { EncodeSession, SessionHooks };
