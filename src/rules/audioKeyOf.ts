// 판정: 이 소리의 캐시 열쇠는. 보는 것은 음원 주소 하나뿐이다. 모르면 null.
//   유튜브        yt:<영상 id>
//   사운드클라우드 sc:<다듬은 경로>(soundcloud.com/ 뒤. 다른 호스트면 호스트부터)
//   직접 링크     dl:<주소의 md5>. 서명된 주소는 쿼리까지 다른 파일이다
// 출처가 달라도 음원 주소가 같으면 파일 하나를 함께 쓴다. 열쇠는 저장하지 않고 쓸 때마다 이것으로 계산한다.

import crypto from "crypto";
import { extractVideoId } from "./links.ts";
import { inputKind } from "./inputKind.ts";
import { canonicalUrl } from "./canonicalUrl.ts";
const md5 = (value: unknown): string => crypto.createHash("md5").update(String(value)).digest("hex");

function audioKeyOf(audioUrl: string | null | undefined): string | null {
  switch (inputKind(audioUrl)) {
    case "youtube": {
      const vid = extractVideoId(audioUrl);
      return vid ? `yt:${vid}` : null;
    }
    case "soundcloud":
      // 사운드클라우드로 가려졌으면 글자다
      return `sc:${canonicalUrl(String(audioUrl)).replace(/^https:\/\/(soundcloud\.com\/)?/, "")}`;
    case "direct":
      return `dl:${md5(audioUrl)}`;
    default:
      return null;
  }
}

export { audioKeyOf, md5 };
