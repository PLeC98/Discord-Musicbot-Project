// 요청한 사용자의 IP와 신뢰하는 프록시. 요청 제한 키, 기기 목록, 로그, 평문 접속 판정에만 쓰고 인증과 권한에는 쓰지 않는다.
//
// 내부 주소(loopback, 사설망, 링크 로컬, 100.64/10, 이 기기의 주소, 이 기기 네트워크 인터페이스의 on-link IPv6 프리픽스)는 자동으로 신뢰한다.
// 같은 네트워크의 기기나 같은 브리지 네트워크의 컨테이너가 X-Forwarded-For로 IP를 위조할 수 있다는 점은 감수한다(Rails, authentik과 같은 기본값).
// 공인 IP의 원격 프록시만 DASHBOARD_TRUST_PROXY에 넣는다. 모든 주소를 신뢰하는 값은 받지 않는다.
// Cloudflare 대역에서 온 홉이면 CF-Connecting-IP를 쓴다(그 값도 Workers로 위조할 수 있어 인증과 권한에는 쓰지 않는다)

import os from "node:os";
import { BlockList } from "node:net";
import type { Request } from "express";
import CLOUDFLARE from "../../data/cloudflare-ips.json" with { type: "json" };
import { blockOf, familyOf, inBlock, isInsideKind, isTransition, normalizeIp, parseCidrList } from "../rules/net-address.ts";

const cloudflare = blockOf([...CLOUDFLARE.v4, ...CLOUDFLARE.v6]);

/** 이 기기 네트워크 인터페이스의 주소와 on-link IPv6 프리픽스 */
type Own = { addresses: BlockList; onLink: BlockList; readAt: number };
/** 이 기기의 주소를 다시 읽는 간격. 쓸 때 이만큼 지났으면 새로 읽는다(타이머로 돌지 않는다) */
const REREAD_MS = 60_000;

let readInterfaces: () => ReturnType<typeof os.networkInterfaces> = os.networkInterfaces;
let own: Own | null = null;

function readOwn(): Own {
  const addresses = new BlockList();
  const onLink = new BlockList();
  for (const list of Object.values(readInterfaces())) {
    for (const a of list ?? []) {
      const ip = normalizeIp(a.address);
      if (!ip) continue;
      const family = familyOf(ip);
      addresses.addAddress(ip, family);
      // 같은 서브넷(on-link)의 전역 IPv6 주소. 프리픽스가 /64보다 좁은 인터페이스(VPS의 /128 등)는 이웃이 없다고 본다.
      // 전환 주소(Teredo, 6to4, NAT64)의 프리픽스는 인터넷의 다른 사용자도 들어 있어 이웃으로 보지 않는다
      const prefix = Number(String(a.cidr ?? "").split("/")[1]);
      if (family === "ipv6" && !a.internal && Number.isInteger(prefix) && prefix > 0 && prefix <= 64 && !isInsideKind(ip) && !isTransition(ip)) onLink.addSubnet(ip, prefix, "ipv6");
    }
  }
  return { addresses, onLink, readAt: Date.now() };
}

/** 이 기기의 주소이거나 이 기기 네트워크 인터페이스의 on-link IPv6 프리픽스 안의 주소인지 */
function isOwn(ip: string) {
  if (!own || Date.now() - own.readAt >= REREAD_MS) own = readOwn();
  const family = familyOf(ip);
  return own.addresses.check(ip, family) || own.onLink.check(ip, family);
}

/** 내부 주소인지(소켓 상대 주소와 사용자 IP를 구분할 때). TCP 연결은 출발지 주소를 위조해 맺을 수 없으므로 이 기기의 주소도 내부 주소로 본다 */
function isInside(addr: string | null | undefined) {
  const ip = normalizeIp(addr);
  if (!ip) return false;
  return isInsideKind(ip) || isOwn(ip);
}

/**
 * Express의 trust proxy 판정 함수를 만든다. 내부 주소와 extra(DASHBOARD_TRUST_PROXY의 공인 IP 프록시)를 신뢰한다.
 * accepted, inside, rejected는 기동 로그에 남긴다
 */
function trustProxy(extra: string | null | undefined) {
  const parsed = parseCidrList(extra);
  const trust = (addr: string) => isInside(addr) || inBlock(parsed.list, addr);
  return { trust, ...parsed };
}

/** 이 요청의 사용자 IP. Express가 신뢰하는 홉을 거쳐 구한 주소가 Cloudflare 대역이면 CF-Connecting-IP(값이 IP 하나일 때만) */
function clientIp(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  if (!inBlock(cloudflare, ip)) return ip;
  const header = req.headers["cf-connecting-ip"];
  const value = Array.isArray(header) ? null : normalizeIp(header);
  return value ?? ip;
}

/** 테스트: 네트워크 인터페이스 조회 함수를 바꾼다(바꾼 뒤 다시 읽는다) */
function _useInterfaces(read: typeof os.networkInterfaces) {
  readInterfaces = read;
  own = null;
}

export { isInside, trustProxy, clientIp, _useInterfaces };
