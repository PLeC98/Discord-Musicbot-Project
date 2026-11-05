# build-twemoji-font.ts 가 부르는 뒤처리. nanoemoji 가 만든 Twemoji COLRv0 글꼴을 화면에 걸 수 있게 고친다.
#   python twemoji-font.py <nanoemoji 결과 TTF> <emoji-test.txt> <내보낼 TTF>
#
# - 글자 문자(공백, #, *, 0 ~ 9, ©, ®, ™, U+20E3)와 키캡을 뺀다. 글꼴이 이 문자를 들고 있으면 글꼴 목록 맨 앞에 둘 때
#   숫자와 기호가 이모지 글꼴 것으로 바뀌고, 키캡은 엔진에 따라 비거나 깨진다(notes 조사 기록 6절).
# - 합자를 emoji-test.txt 의 모든 형태(fully-qualified, minimally-qualified, unqualified)와 fe0f 를 다 뺀 형태로 넣는다.
#   nanoemoji 는 Twemoji 파일 이름의 형태 하나로만 합자를 만드는데, 엔진마다 찾는 형태가 다르다
#   (아이패드는 받은 그대로, 윈도우용 WebKit 은 fe0f 를 뺀 형태). 한 형태만 있으면 그 엔진에서 순서열이 나뉜다.
import json
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.otTables import Ligature

TEXT_CHARS = {0x20, 0x23, 0x2A, 0xA9, 0xAE, 0x2122, 0x20E3} | set(range(0x30, 0x3A))
STATUSES = ("fully-qualified", "minimally-qualified", "unqualified")


def emoji_test_sequences(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or ";" not in line:
                continue
            codes, rest = line.split(";", 1)
            if rest.split("#", 1)[0].strip() in STATUSES:
                yield tuple(int(c, 16) for c in codes.split())


def strip_fe0f(seq):
    return tuple(c for c in seq if c != 0xFE0F)


def main(source, emoji_test, out):
    font = TTFont(source)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.drop_tables = []
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[cp for cp in font.getBestCmap() if cp not in TEXT_CHARS])
    subsetter.subset(font)

    cmap = font.getBestCmap()
    glyph_cp = {glyph: cp for cp, glyph in cmap.items()}
    lookups = font["GSUB"].table.LookupList.Lookup
    if len(lookups) != 1 or len(lookups[0].SubTable) != 1 or lookups[0].LookupType != 4:
        raise SystemExit("nanoemoji 의 GSUB 가 합자 lookup 하나가 아니다. 이 뒤처리를 그 형식에 맞게 고쳐야 한다")
    table = lookups[0].SubTable[0]

    have = {}
    for first, ligatures in table.ligatures.items():
        for lig in ligatures:
            have[(glyph_cp[first], *(glyph_cp[g] for g in lig.Component))] = lig.LigGlyph
    by_stripped = {}
    for seq, glyph in have.items():
        by_stripped.setdefault(strip_fe0f(seq), glyph)

    wanted = {strip_fe0f(seq) for seq in have} | set(emoji_test_sequences(emoji_test))
    added = 0
    for seq in sorted(wanted):
        if len(seq) < 2 or seq in have or any(cp not in cmap for cp in seq):
            continue
        glyph = by_stripped.get(strip_fe0f(seq))
        if glyph is None:
            continue
        lig = Ligature()
        lig.LigGlyph = glyph
        lig.Component = [cmap[cp] for cp in seq[1:]]
        table.ligatures.setdefault(cmap[seq[0]], []).append(lig)
        have[seq] = glyph
        added += 1
    # 긴 것부터 맞춰 봐야 앞부분만 맞는 짧은 합자가 먼저 걸리지 않는다
    for ligatures in table.ligatures.values():
        ligatures.sort(key=lambda lig: -len(lig.Component))

    font.save(out)
    print(json.dumps({"added": added, "ligatures": len(have), "codepoints": len(cmap)}))


if __name__ == "__main__":
    main(*sys.argv[1:4])
