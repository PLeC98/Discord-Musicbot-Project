// 이 호스트의 네트워크 송신 누계(인터페이스마다 바이트). 봇 상태 탭의 시스템 업로드.
// Linux 는 /sys/class/net/<이름>/statistics/tx_bytes 를 읽는다(프로그램을 실행하지 않는다). 장치가 있는 인터페이스만 센다
// (docker 브리지 · veth · VPN 은 같은 바이트가 실제 카드에서 한 번 더 세진다). 장치가 하나도 없으면(컨테이너 안) 루프백만 뺀다.
// Windows 는 Node 에 API 가 없어 PowerShell 하나를 띄워 두고 물을 때마다 .NET NetworkInterface 로 읽는다
// (WMI 를 거치는 Get-NetAdapterStatistics 보다 싸고, 조회마다 띄우면 PowerShell 기동 비용이 매번 든다). 이더넷 · 무선 종류만 센다.
//   언어 설정과 상관없게 인터페이스 Id(GUID)와 숫자만 받는다. 자식 프로세스 기록에 올려 봇이 내려갈 때 함께 내리고, 봇이 갑자기 죽으면 stdin 이 닫혀 스스로 끝난다.
// 그 밖의 운영체제는 재지 않는다(null). 읽지 못하면 null 을 주고 warn 으로 알린다

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { messageOf } from "./error-text.ts";
import { repeatingFailure } from "./repeating-failure.ts";
import * as processRegistry from "./process-registry.ts";
const log = logger.child({ category: "proc" });

type Sent = Map<string, number>;

const SYS_NET = "/sys/class/net";
const ANSWER_TIMEOUT_MS = 10_000;
// 셸이 죽거나 답하지 않으면 이만큼 기다렸다 다시 띄운다(띄우는 비용이 크다). 다시 응답하면 처음 간격부터
const RESTART_DELAYS_MS = [60_000, 300_000, 1_800_000];

const failures = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "시스템 업로드 읽기");

/** 두 누계 사이에 보낸 양. 두 번 다 있는 인터페이스만 센다(새로 생기거나 사라진 것은 뺀다). 누계가 줄었으면(다시 만들어졌다) 그 인터페이스는 뺀다 */
function sentBetween(from: Sent, to: Sent) {
  let sum = 0;
  for (const [name, bytes] of to) {
    const before = from.get(name);
    if (before !== undefined && bytes >= before) sum += bytes - before;
  }
  return sum;
}

// ── Linux ──

async function fromSysfs(dir = SYS_NET): Promise<Sent> {
  const names = (await fs.promises.readdir(dir)).filter((name) => name !== "lo");
  const physical = names.filter((name) => fs.existsSync(path.join(dir, name, "device")));
  const sent: Sent = new Map();
  for (const name of physical.length ? physical : names) {
    const bytes = Number((await fs.promises.readFile(path.join(dir, name, "statistics", "tx_bytes"), "utf8")).trim());
    if (Number.isFinite(bytes)) sent.set(name, bytes);
  }
  return sent;
}

// ── Windows ──

// 줄마다 "Id<탭>보낸 바이트", 빈 줄이 답의 끝. 종류: Ethernet(6) · Wireless80211(71) · FastEthernetT(62) · FastEthernetFx(69) · GigabitEthernet(117) · Ethernet3Megabit(26)
const SCRIPT = `
$kinds = 6, 71, 62, 69, 117, 26
while ($null -ne [Console]::In.ReadLine()) {
  foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($kinds -notcontains [int]$n.NetworkInterfaceType) { continue }
    try { [Console]::Out.WriteLine($n.Id + [char]9 + $n.GetIPStatistics().BytesSent) } catch { }
  }
  [Console]::Out.WriteLine('')
  [Console]::Out.Flush()
}`;

/** PowerShell 답 한 번(빈 줄 앞까지)의 줄들 */
function parseAnswer(lines: string[]): Sent {
  const sent: Sent = new Map();
  for (const line of lines) {
    const [id, bytes] = line.split("\t");
    if (id && /^\d+$/.test(bytes ?? "")) sent.set(id, Number(bytes));
  }
  return sent;
}

type Shell = { child: ChildProcessWithoutNullStreams; release: () => void; lines: string[]; rest: string; answer: ((got: Sent | { failed: string }) => void) | null; stderr: string };
let shell: Shell | null = null;
let restartAt = 0;
let restarts = 0;

function startShell(): Shell {
  const child = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-NonInteractive", "-EncodedCommand", Buffer.from(SCRIPT, "utf16le").toString("base64")], { windowsHide: true });
  const self: Shell = { child, release: processRegistry.register(child, "powershell", { job: "net-stats" }), lines: [], rest: "", answer: null, stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const parts = (self.rest + chunk).split(/\r?\n/);
    self.rest = parts.pop()!;
    for (const line of parts) {
      if (line) self.lines.push(line);
      else {
        const sent = parseAnswer(self.lines);
        self.lines = [];
        self.answer?.(sent);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (self.stderr = (self.stderr + chunk).slice(-300)));
  child.stdin.on("error", () => {
    /* 끝난 뒤 쓰면 EPIPE 가 난다. 끝남은 exit 가 알린다 */
  });
  // 묻는 중이 아니면(봇이 내려가며 내렸다 등) 조용히 비우고, 다음 구간에 다시 띄운다
  const gone = (why: string) => {
    if (shell === self) shell = null;
    self.release();
    self.answer?.({ failed: why });
  };
  child.on("error", (error) => gone(messageOf(error)));
  child.on("exit", (code, signal) => gone(`PowerShell 종료(${signal ?? `종료 코드 ${String(code)}`})${self.stderr.trim() ? ` · ${self.stderr.trim()}` : ""}`));
  // 봇이 나가는 것을 붙잡지 않는다
  child.unref();
  for (const stream of [child.stdin, child.stdout, child.stderr]) (stream as unknown as { unref?: () => void }).unref?.();
  return self;
}

function ask(self: Shell): Promise<Sent | { failed: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // 끝나기를 기다리지 않고 놓는다(다음 구간이 멈춘 셸에 다시 묻지 않게)
      if (shell === self) shell = null;
      processRegistry.kill(self.child);
      finish({ failed: `${ANSWER_TIMEOUT_MS / 1000}초 안에 응답이 없어 종료` });
    }, ANSWER_TIMEOUT_MS).unref();
    const finish = (got: Sent | { failed: string }) => {
      clearTimeout(timer);
      self.answer = null;
      resolve(got);
    };
    self.answer = finish;
    self.child.stdin.write("\n");
  });
}

async function fromShell(): Promise<Sent | { failed: string } | null> {
  if (!shell) {
    // 다시 띄울 때가 아니면 이번 구간은 비운다(실패는 이미 알렸다)
    if (Date.now() < restartAt) return null;
    shell = startShell();
  }
  if (shell.answer) return null;
  const got = await ask(shell);
  if ("failed" in got) {
    restartAt = Date.now() + RESTART_DELAYS_MS[Math.min(restarts++, RESTART_DELAYS_MS.length - 1)];
    return got;
  }
  restarts = 0;
  return got;
}

/** 지금 누계. 재지 않는 운영체제거나 읽지 못했으면 null */
async function systemSent(): Promise<Sent | null> {
  let got: Sent | { failed: string } | null;
  if (process.platform === "linux") {
    try {
      got = await fromSysfs();
    } catch (error) {
      got = { failed: `${SYS_NET}: ${messageOf(error)}` };
    }
  } else if (process.platform === "win32") got = await fromShell();
  else return null;
  if (got === null) return null;
  // 잴 인터페이스가 하나도 없으면 0 이 아니라 못 잰 것이다
  if (!("failed" in got) && got.size === 0) got = { failed: "측정할 수 있는 네트워크 인터페이스가 없음" };
  if ("failed" in got) {
    failures.fail(got.failed);
    return null;
  }
  failures.ok();
  return got;
}

export { systemSent, sentBetween, parseAnswer, fromSysfs, SCRIPT };
export type { Sent };
