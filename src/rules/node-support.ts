// Node 지원 범위(package.json 의 engines.node). 범위는 LTS 줄마다의 보안 하한이라, 보안 릴리스가 나오면 이 값만 올린다.
// 읽는 꼴은 "^a.b.c"(같은 메이저에서 그 판 이상)와 ">=a.b.c"(그 판 이상)를 "||" 로 이은 것뿐이다. 그 밖의 꼴이면 판단하지 않는다

type Version = [number, number, number];

function parse(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function atLeast(version: Version, floor: Version) {
  for (let i = 0; i < 3; i++) if (version[i] !== floor[i]) return version[i]! > floor[i]!;
  return true;
}

/** version 이 range 안인가. 범위나 판을 읽지 못하면 null */
function satisfiesNode(version: string, range: string): boolean | null {
  const now = parse(version);
  const parts = range.split("||").map((part) => /^(\^|>=)\s*(\d+\.\d+\.\d+)$/.exec(part.trim()));
  if (!now || !range.trim() || parts.some((part) => !part)) return null;
  return parts.some((part) => {
    const floor = parse(part![2]!)!;
    return atLeast(now, floor) && (part![1] === ">=" || now[0] === floor[0]);
  });
}

/** 지원 범위 밖이면 기동 경고 문장. 안이거나 판단하지 못하면 null */
function nodeSupportWarning(version: string, range: string): string | null {
  if (satisfiesNode(version, range) !== false) return null;
  return `지원 범위 밖의 Node(지금 ${version}, 지원 ${range}). 알려진 보안 취약점이 고쳐진 판으로 올리세요`;
}

export { satisfiesNode, nodeSupportWarning };
