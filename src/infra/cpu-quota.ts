// Linux cgroup v2의 CPU 상한. 컨테이너의 CPU 제한(docker --cpus)이나 systemd의 CPUQuota로 걸린다.
// 상한은 cgroup 전체에 걸려서, 자식 프로세스까지 합쳐 한 주기의 할당량을 다 쓰면 봇도 다음 주기까지 멈춘다

import fs from "node:fs";
import path from "node:path";

type Read = (file: string) => string;

const ROOT = "/sys/fs/cgroup";

/**
 * 이 프로세스가 쓸 수 있는 CPU 수(1.5처럼 소수도 나온다). 상한이 없거나 못 읽으면 null.
 * 이 프로세스의 cgroup에서 루트까지 올라가며 가장 작은 상한을 고른다(상한은 상위 cgroup에 걸려 있을 수도 있다)
 */
function cpuQuota(platform: NodeJS.Platform = process.platform, read: Read = (file) => fs.readFileSync(file, "utf8")): number | null {
  if (platform !== "linux") return null;
  let lowest: number | null = null;
  for (let group = ownGroup(read); ; group = path.posix.dirname(group)) {
    const cpus = quotaOf(group, read);
    if (cpus !== null && (lowest === null || cpus < lowest)) lowest = cpus;
    if (group === "/") return lowest;
  }
}

// 이 프로세스의 cgroup 경로. cgroup v2에서는 "0::/경로" 한 줄이다. 컨테이너 안에서는 이 프로세스의 cgroup이 루트("/")로 보인다
function ownGroup(read: Read): string {
  try {
    const line = read("/proc/self/cgroup")
      .split("\n")
      .find((text) => text.startsWith("0::"));
    const group = line?.slice(3).trim();
    return group?.startsWith("/") ? path.posix.normalize(group) : "/";
  } catch {
    return "/";
  }
}

// cpu.max는 "할당량 주기"(μs) 형식이고 상한이 없으면 할당량이 "max" 다. 루트 cgroup에는 이 파일이 없다
function quotaOf(group: string, read: Read): number | null {
  try {
    const [quota, period] = read(path.posix.join(ROOT, group, "cpu.max"))
      .trim()
      .split(/\s+/);
    if (!quota || quota === "max" || !period) return null;
    const cpus = Number(quota) / Number(period);
    return Number.isFinite(cpus) && cpus > 0 ? cpus : null;
  } catch {
    return null;
  }
}

export { cpuQuota };
