# NOTICE

이 저장소는 [umutxyp/MusicBot](https://github.com/umutxyp/MusicBot)의 포크입니다.
This repository is a fork of [umutxyp/MusicBot](https://github.com/umutxyp/MusicBot).

## 라이선스 구조 / License Structure

- **업스트림 베이스 (Upstream base)**: umutxyp/MusicBot 커밋 `e3c825e5ec19c8756bf6612bb7f1f7569501e526` 까지의 코드 -
  Copyright (c) 2025 umutxyp, **MIT License** ([LICENSE-MIT](LICENSE-MIT) 참조)

- **이 저장소의 수정·추가분 (Modifications in this repository)**: 위 커밋 이후
  이 저장소에서 새로 작성된 모든 변경분 -
  Copyright (C) 2026 PLeC, **GNU AGPL-3.0-or-later** ([LICENSE](LICENSE) 참조)

- **이후 업스트림에서 가져오는 코드 (Code later incorporated from upstream)**:
  cherry-pick 등으로 업스트림에서 가져온 코드는 원 저작자의 MIT 라이선스를
  유지합니다.

## 결합 저작물 / Combined Work

이 저장소를 전체로 배포·사용할 때는 AGPL-3.0의 조건이 적용됩니다.
MIT 부분의 저작권 고지와 라이선스 전문은 LICENSE-MIT 파일로 보존됩니다.

When the repository is distributed or used as a whole, the terms of the
GNU AGPL-3.0 apply to the combined work. The copyright notice and license
text of the MIT-licensed portions are preserved in LICENSE-MIT.

## 함께 넣은 데이터 / Bundled Data

`src/rules/kanjiFinals.ts` 는 유니코드 Unihan 데이터베이스(`Unihan_Readings.txt`)의 일본어 읽기에서 만든 표입니다
(`scripts/build-kanji-finals.ts`). 아래 Unicode License v3 를 따릅니다.

`src/rules/kanjiFinals.ts` is derived from the Japanese readings in the Unicode Unihan database
(`Unihan_Readings.txt`, via `scripts/build-kanji-finals.ts`) and is used under the Unicode License v3 below.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```
