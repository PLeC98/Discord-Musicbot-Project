// 주소가 바깥에서 닿는 공개 주소인가. 외부 링크 가드(infra/safe-url)와 패널의 대시보드 링크가 같은 판정을 쓴다.

import ipaddr from "ipaddr.js";

/**
 * 공인(global unicast) IP 인가. 그 밖(사설 · 루프백 · 링크로컬 · CGNAT · 예약 · 멀티캐스트 등)은 아니다.
 * 읽지 못하면 아니다. IPv4 를 담은 IPv6(::ffff:x)는 안의 IPv4 로 본다.
 * 막을 대역을 적지 않고 공인 unicast 만 통과시키므로, 라이브러리가 새 특수 대역을 알면 따라 막힌다.
 */
function isPublicIp(ip: string): boolean {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) return isPublicIp(addr.toIPv4Address().toString());
  return addr.range() === "unicast";
}

// 안쪽 망에서만 통하는 이름
const LOCAL_NAMES = [".localhost", ".local", ".lan", ".home.arpa", ".internal"];

/**
 * 주소의 호스트가 공개 주소인가. IP 로 적었으면 공인 unicast, 이름이면 localhost 와 안쪽 망 이름이 아니면.
 * 이름이 가리키는 IP(DNS)는 보지 않는다. 주소를 읽지 못하면 아니다
 */
function isPublicUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  const ip = host.replace(/^\[(.*)\]$/, "$1");
  if (ipaddr.isValid(ip)) return isPublicIp(ip);
  return host !== "localhost" && !LOCAL_NAMES.some((suffix) => host.endsWith(suffix));
}

export { isPublicIp, isPublicUrl };
