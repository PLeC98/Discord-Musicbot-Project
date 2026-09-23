const path = require("path");
const links = require("../rules/links");
const log = require("../infra/log/logger").child({ category: "link" });
const SafeUrl = require("../infra/safeUrl");

class DirectLink {
  /**
   * 직접 오디오 링크의 메타데이터 조회.
   * 다른 플랫폼의 search()와 동일한 배열 계약을 따른다. 성공 시 [track], 실패 시 [].
   * 네트워크 요청은 SafeUrl(SSRF 가드)을 통과한다.
   */
  static async getInfo(url) {
    try {
      if (!links.isDirectAudioLink(url)) {
        return [];
      }

      // SSRF 가드된 HEAD. Content-Type/크기 검증 포함
      const { headers } = await SafeUrl.head(url);
      const contentType = headers["content-type"] || "";
      const contentLength = headers["content-length"];

      const urlPath = new URL(url).pathname;
      const filename = path.basename(urlPath) || "알 수 없는 파일";
      const extension = path.extname(filename).toLowerCase();
      const estimatedDuration = this.estimateDuration(contentLength, contentType);

      return [
        {
          title: this.extractTitle(filename),
          artist: "직접 링크",
          url: url,
          // 서명된 주소는 쿼리에 토큰이 있어 다듬지 않는다(canonicalUrl 도 그대로 돌려준다)
          pageUrl: url,
          requestKey: url,
          audioUrl: url,
          duration: estimatedDuration,
          // Content-Length 기반 추정. 다운로드 후 probeDurationSec가 실측으로 교체한다.
          durationSource: "추정",
          // 임의의 오디오 URL이라 앨범아트를 알 방법이 없다. 대시보드가 파일 아이콘으로 대체 표시한다.
          thumbnail: null,
          platform: "direct",
          type: "track",
          id: this.generateId(url),
          fileSize: contentLength ? parseInt(contentLength) : null,
          contentType: contentType,
          extension: extension,
          filename: filename,
        },
      ];
    } catch (error) {
      // SSRF 차단 등 실패 상세는 서버 로그로만 (사용자에겐 상위에서 "결과 없음")
      log.error("직접 링크 정보 조회 실패:", error.message || error);
      return [];
    }
  }

  /**
   * 재생/다운로드용 스트림 획득. SSRF 가드된 Readable 반환.
   * 직접 링크는 URL 기반 탐색을 지원하지 않음. 탐색은 MusicPlayer의 FFmpeg가 처리하므로
   * startSeconds는 여기서 무시한다.
   */
  static async getStream(url) {
    try {
      if (!links.isDirectAudioLink(url)) {
        throw new Error("지원되지 않는 직접 오디오 파일 링크");
      }
      return await SafeUrl.getStream(url);
    } catch (error) {
      // SSRF 오라클 방지: 차단 사유는 로그로만, 사용자에겐 일반화된 오류만 (cause는 스택용. 사용자 노출 없음)
      log.error("직접 링크 스트림 실패:", error.message || error);
      throw new Error("재생할 수 없는 링크입니다", { cause: error });
    }
  }

  // 참고: 동기 함수로 유지해야 함. getInfo()가 반환값을
  // track.title에 직접 할당함 (비동기 버전은 "[object Promise]"를 생성했음)
  static extractTitle(filename) {
    // 확장자를 제거하고 파일명 정리
    const nameWithoutExt = path.parse(filename).name;

    // 일반적인 구분자를 공백으로 교체
    let title = nameWithoutExt.replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim();

    // 각 단어의 첫 글자를 대문자로 변환
    title = title.replace(/\b\w/g, (l) => l.toUpperCase());

    return title || "알 수 없는 제목";
  }

  static generateId(url) {
    // URL 기반의 간단한 ID 생성
    return Buffer.from(url).toString("base64").substring(0, 16);
  }

  static estimateDuration(fileSize, contentType) {
    if (!fileSize) return 0;

    // 파일 크기와 타입을 바탕으로 대략 추정
    // 매우 대략적인 추정값이므로 정확하지 않음
    let estimatedBitrate = 128; // 기본 kbps

    if (contentType.includes("mp3")) {
      estimatedBitrate = 128;
    } else if (contentType.includes("wav")) {
      estimatedBitrate = 1411; // CD 음질
    } else if (contentType.includes("flac")) {
      estimatedBitrate = 1000;
    } else if (contentType.includes("ogg")) {
      estimatedBitrate = 160;
    }

    // 파일 크기를 비트로 변환한 뒤 비트레이트로 나누어 초 단위 계산
    const fileSizeBits = fileSize * 8;
    const bitratePerSecond = estimatedBitrate * 1000;
    const estimatedSeconds = Math.floor(fileSizeBits / bitratePerSecond);

    return Math.max(0, estimatedSeconds);
  }
}

module.exports = DirectLink;
