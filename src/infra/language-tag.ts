// 언어 태그 맞추기: 원하는 태그 목록(앞이 먼저)에서 가진 언어 가운데 가장 가까운 것을 고른다. 화면(브라우저 언어), 서버가 그리는 HTML(Accept-Language),
// 로그 언어(LOG_LANGUAGE, OS 언어), 이름 표가 같이 쓴다. 화면 번들과 로그 언어 고르기(설정, 로거보다 먼저 돈다)도 부르므로 Intl과 데이터 파일만 쓴다.
//
// 태그마다 차례로 본다(다음 태그는 앞 태그가 아무것도 못 찾았을 때만):
//   1. 정확히 같은 것(대소문자 무시)
//   2. 양쪽을 Intl.Locale.maximize()로 채워(zh-HK → zh-Hant-HK, ko → ko-Kore-KR) 언어와 문자 체계가 같은 것. 지역까지 같으면 먼저,
//      아니면 CLDR이 가깝다고 정한 지역 묶음(data/cldr-region-groups.json: 미국 밖의 영어는 en-GB, 아메리카의 스페인어는 es-419, 홍콩과 마카오 등) 안의 것, 그다음 목록 차례
// 문자 체계가 다르면 맞추지 않는다(zh-TW를 원하는데 간체만 있으면 다음 태그로). CLDR도 번체와 간체 사이에 따로 정했던 거리를 없앴다(CLDR-14355).
// Intl.Locale이 인식하지 못하는 태그(*, x-test)는 1만 보고, und(모름)는 채우면 영어가 되므로 2에 넣지 않는다.

import REGIONS from "../../data/cldr-region-groups.json" with { type: "json" };

type Parsed = { language: string; script: string; region: string };

/** 채운 언어, 문자 체계, 지역. 인식하지 못하는 태그와 und는 null */
function parse(tag: string): Parsed | null {
  try {
    const locale = new Intl.Locale(tag);
    // und의 language는 Node에서 비어 있다(undefined)
    if (!locale.language || locale.language === "und") return null;
    const full = locale.maximize();
    return { language: full.language, script: full.script ?? "", region: full.region ?? "" };
  } catch {
    return null;
  }
}

const GROUPS: Record<string, readonly string[] | undefined> = REGIONS.groups;
const PREFER_OUTSIDE: Record<string, string | undefined> = REGIONS.preferOutside;

/** 같은 언어, 문자 체계인 후보 가운데 원하는 지역에 가장 가까운 것 */
function nearest(want: Parsed, candidates: readonly { tag: string; parsed: Parsed }[]): string {
  const sameRegion = candidates.find((one) => one.parsed.region === want.region);
  if (sameRegion) return sameRegion.tag;
  const key = want.language === "zh" ? `zh-${want.script}` : want.language;
  const group = GROUPS[key];
  if (group) {
    const inside = group.includes(want.region);
    const preferred = !inside && PREFER_OUTSIDE[key] ? candidates.find((one) => one.parsed.region === PREFER_OUTSIDE[key]) : undefined;
    const pick = preferred ?? candidates.find((one) => group.includes(one.parsed.region) === inside);
    if (pick) return pick.tag;
  }
  return candidates[0].tag;
}

/** 원하는 태그 목록에서 가진 태그(available, 그 철자 그대로 돌려준다) 가운데 가장 가까운 것. 없으면 null */
function matchTag(desired: readonly string[], available: readonly string[]): string | null {
  const own = available.map((tag) => ({ tag, lower: tag.toLowerCase(), parsed: parse(tag) }));
  for (const raw of desired) {
    const tag = raw.trim();
    if (!tag) continue;
    const exact = own.find((one) => one.lower === tag.toLowerCase());
    if (exact) return exact.tag;
    const want = parse(tag);
    if (!want) continue;
    const candidates = own.flatMap((one) => (one.parsed && one.parsed.language === want.language && one.parsed.script === want.script ? [{ tag: one.tag, parsed: one.parsed }] : []));
    if (candidates.length) return nearest(want, candidates);
  }
  return null;
}

export { matchTag };
