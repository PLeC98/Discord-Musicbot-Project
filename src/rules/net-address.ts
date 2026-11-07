// IP 주소 분류와 IP, CIDR 목록 파싱. 대시보드가 사용자 IP 확인, 신뢰하는 프록시 설정, 평문 접속 판정에 쓴다.
// 내부 주소는 사설망 등의 주소라는 뜻일 뿐 신뢰할 수 있는 사용자라는 뜻도, 암호화된 연결이라는 뜻도 아니다. 인증과 권한에는 쓰지 않는다

import { BlockList, isIP } from "node:net";

type Kind = "loopback" | "private" | "link-local" | "cgnat" | "public";
type Family = "ipv4" | "ipv6";

/** 검사를 마친 IPv6 주소의 16비트 그룹 8개 */
function groupsOf(ip: string): number[] {
  let text = ip;
  const tail: number[] = [];
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const hex = (part: string) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const [head, rest] = text.split("::");
  const front = hex(head);
  const back = [...hex(rest ?? ""), ...tail];
  const fill = rest === undefined ? [] : new Array<number>(8 - front.length - back.length).fill(0);
  return [...front, ...fill, ...back];
}

/** IPv4 매핑 IPv6(::ffff:0:0/96)면 그 IPv4 */
function mappedV4(ip: string): string | null {
  const g = groupsOf(ip);
  if (g.slice(0, 5).some(Boolean) || g[5] !== 0xffff) return null;
  return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
}

/**
 * 소켓이나 헤더의 주소를 정규화한다. IPv4 매핑 IPv6(::ffff:1.2.3.4, ::ffff:102:304)는 IPv4로 바꾸고 대괄호와 영역 ID(%eth0)는 뗀다.
 * 영역 ID는 IPv6에만 붙고 영문자, 숫자, `_.-`만 받는다. 유효한 IP가 아니면 null
 */
function normalizeIp(text: string | null | undefined): string | null {
  let ip = String(text ?? "")
    .trim()
    .toLowerCase();
  const bracketed = ip.startsWith("[") && ip.endsWith("]");
  if (bracketed) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone >= 0) {
    if (!/^[\w.-]+$/.test(ip.slice(zone + 1))) return null;
    ip = ip.slice(0, zone);
    if (isIP(ip) !== 6) return null;
  }
  const family = isIP(ip);
  if (family === 0 || (bracketed && family !== 6)) return null;
  return family === 6 ? (mappedV4(ip) ?? ip) : ip;
}

function familyOf(ip: string): Family {
  return isIP(ip) === 6 ? "ipv6" : "ipv4";
}

function ranges(list: Array<[string, number, Family]>) {
  const block = new BlockList();
  for (const [net, prefix, family] of list) block.addSubnet(net, prefix, family);
  return block;
}

const LOOPBACK: Array<[string, number, Family]> = [
  ["127.0.0.0", 8, "ipv4"],
  ["::1", 128, "ipv6"],
];
const PRIVATE: Array<[string, number, Family]> = [
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["fc00::", 7, "ipv6"],
];
const LINK_LOCAL: Array<[string, number, Family]> = [
  ["169.254.0.0", 16, "ipv4"],
  ["fe80::", 10, "ipv6"],
];
// 통신사 CGNAT와 Tailscale이 쓰는 대역(RFC 6598)
const CGNAT: Array<[string, number, Family]> = [["100.64.0.0", 10, "ipv4"]];

const KINDS: Array<[Exclude<Kind, "public">, BlockList]> = [
  ["loopback", ranges(LOOPBACK)],
  ["private", ranges(PRIVATE)],
  ["link-local", ranges(LINK_LOCAL)],
  ["cgnat", ranges(CGNAT)],
];
const INSIDE_SUBNETS = [...LOOPBACK, ...PRIVATE, ...LINK_LOCAL, ...CGNAT];

/** 주소의 종류. 유효한 IP가 아니면 null */
function kindOf(text: string | null | undefined): Kind | null {
  const ip = normalizeIp(text);
  if (!ip) return null;
  const family = familyOf(ip);
  return KINDS.find(([, block]) => block.check(ip, family))?.[0] ?? "public";
}

/** 주소 종류만으로 내부 주소인지(loopback, 사설망, 링크 로컬, 100.64/10). 이 기기의 주소와 on-link 프리픽스는 호출하는 쪽에서 더 본다 */
function isInsideKind(text: string | null | undefined) {
  const kind = kindOf(text);
  return kind !== null && kind !== "public";
}

type Cidr = { ip: string; prefix: number; family: Family };

/**
 * IP나 CIDR 하나를 읽는다. 프리픽스가 없으면 주소 하나, 프리픽스 길이는 1 이상이다(/0은 모든 주소라 받지 않는다).
 * IPv4 매핑 IPv6 대역(::ffff:203.0.113.0/120)은 IPv4 대역으로 바꾼다. 형식이 잘못되면 null
 */
function parseCidr(text: string): Cidr | null {
  const [addr, prefixText, extra] = text.trim().split("/");
  const ip = normalizeIp(addr);
  if (!ip || extra !== undefined || addr.includes("%")) return null;
  const wasV6 = addr.includes(":");
  const max = wasV6 ? 128 : 32;
  let prefix = prefixText === undefined ? max : /^\d+$/.test(prefixText) ? Number(prefixText) : NaN;
  if (!Number.isInteger(prefix) || prefix > max) return null;
  if (wasV6 && familyOf(ip) === "ipv4") prefix -= 96;
  return prefix < 1 ? null : { ip, prefix, family: familyOf(ip) };
}

/** 그 대역이 IPv4 매핑 IPv6 대역 전체를 포함하는지(BlockList는 이런 IPv6 대역에 모든 IPv4 주소도 매칭한다) */
const coversAllIpv4 = ({ ip, prefix, family }: Cidr) => family === "ipv6" && prefix <= 96 && ranges([[ip, prefix, family]]).check("::ffff:0:0", "ipv6");

// Express가 지원하는 대역 키워드. 모두 내부 주소 대역이라 넣지 않아도 신뢰한다
const INSIDE_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

type Entry = { kind: "reject" | "inside" } | ({ kind: "accept" } & Cidr);

/**
 * 목록의 한 항목을 허용할 공인 IP나 CIDR(accept), 이미 신뢰하는 내부 대역(inside), 거부할 값(reject)으로 분류한다.
 * 거부하는 값: 잘못된 형식, 모든 주소를 신뢰하는 값(*, true, /0, 모든 IPv4를 포함하는 IPv6 대역)
 */
function entryOf(entry: string): Entry {
  if (INSIDE_KEYWORDS.has(entry.toLowerCase())) return { kind: "inside" };
  const cidr = parseCidr(entry);
  if (!cidr || coversAllIpv4(cidr)) return { kind: "reject" };
  const inside = INSIDE_SUBNETS.some(([net, p, f]) => f === cidr.family && cidr.prefix >= p && ranges([[net, p, f]]).check(cidr.ip, f));
  return inside ? { kind: "inside" } : { kind: "accept", ...cidr };
}

/**
 * 쉼표로 구분한 IP, CIDR 목록을 파싱한다. list: 허용한 대역(BlockList), accepted: 허용한 항목,
 * inside: 이미 내부 대역이라 필요 없는 항목, rejected: 거부한 항목
 */
function parseCidrList(text: string | null | undefined) {
  const list = new BlockList();
  const accepted: string[] = [];
  const inside: string[] = [];
  const rejected: string[] = [];
  for (const raw of String(text ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const got = entryOf(entry);
    if (got.kind === "accept") {
      list.addSubnet(got.ip, got.prefix, got.family);
      accepted.push(entry);
    } else (got.kind === "inside" ? inside : rejected).push(entry);
  }
  return { list, accepted, inside, rejected };
}

/** CIDR 문자열 목록으로 만든 BlockList. 형식이 잘못된 항목은 건너뛴다 */
function blockOf(cidrs: readonly string[]) {
  const block = new BlockList();
  for (const c of cidrs) {
    const cidr = parseCidr(c);
    if (cidr) block.addSubnet(cidr.ip, cidr.prefix, cidr.family);
  }
  return block;
}

/** BlockList에 주소가 들어 있는지(IPv4 매핑 IPv6도 IPv4로 본다) */
function inBlock(block: BlockList, text: string | null | undefined) {
  const ip = normalizeIp(text);
  return ip !== null && block.check(ip, familyOf(ip));
}

export { normalizeIp, kindOf, isInsideKind, parseCidr, parseCidrList, blockOf, inBlock, familyOf };
export type { Kind, Family };
