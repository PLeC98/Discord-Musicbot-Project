const path = require("path");
const SafeUrl = require("./SafeUrl");

class DirectLink {
  static supportedFormats = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus", ".webm", ".mp4", ".mkv", ".avi", ".mov"];

  /**
   * 직접 오디오 링크의 메타데이터 조회.
   * 다른 플랫폼의 search()와 동일한 배열 계약을 따른다 — 성공 시 [track], 실패 시 [].
   * 네트워크 요청은 SafeUrl(SSRF 가드)을 통과한다.
   */
  static async getInfo(url, guildId = null) {
    try {
      if (!this.isDirectAudioLink(url)) {
        return [];
      }

      // SSRF 가드된 HEAD — Content-Type/크기 검증 포함
      const { headers } = await SafeUrl.head(url);
      const contentType = headers["content-type"] || "";
      const contentLength = headers["content-length"];

      const urlPath = new URL(url).pathname;
      const filename = path.basename(urlPath) || "알 수 없는 파일";
      const extension = path.extname(filename).toLowerCase();
      const estimatedDuration = this.estimateDuration(contentLength, contentType);

      return [
        {
          title: this.extractTitle(filename, guildId),
          artist: "직접 링크",
          url: url,
          duration: estimatedDuration,
          thumbnail: this.getDefaultThumbnail(extension),
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
      console.error("[DirectLink] getInfo() failed:", error.message || error);
      return [];
    }
  }

  /**
   * 재생/다운로드용 스트림 획득 — SSRF 가드된 Readable 반환.
   * 직접 링크는 URL 기반 탐색을 지원하지 않음 — 탐색은 MusicPlayer의 FFmpeg가 처리하므로
   * startSeconds는 여기서 무시한다.
   */
  static async getStream(url, guildId = null, startSeconds = 0) {
    try {
      if (!this.isDirectAudioLink(url)) {
        throw new Error("지원되지 않는 직접 오디오 파일 링크");
      }
      return await SafeUrl.getStream(url);
    } catch (error) {
      // SSRF 오라클 방지: 차단 사유는 로그로만, 사용자에겐 일반화된 오류만
      console.error("[DirectLink] getStream() failed:", error.message || error);
      throw new Error("재생할 수 없는 링크입니다");
    }
  }

  static isDirectAudioLink(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();

      // URL이 지원되는 오디오 형식으로 끝나는지 확인
      const hasAudioExtension = this.supportedFormats.some((format) => pathname.endsWith(format));

      // 직접 HTTP/HTTPS 링크인지 확인
      const isHttpLink = urlObj.protocol === "http:" || urlObj.protocol === "https:";

      return isHttpLink && hasAudioExtension;
    } catch (error) {
      return false;
    }
  }

  // 참고: 동기 함수로 유지해야 함 — getInfo()가 반환값을
  // track.title에 직접 할당함 (비동기 버전은 "[object Promise]"를 생성했음)
  static extractTitle(filename, guildId = null) {
    // 확장자를 제거하고 파일명 정리
    const nameWithoutExt = path.parse(filename).name;

    // 일반적인 구분자를 공백으로 교체
    let title = nameWithoutExt
      .replace(/[-_\.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 각 단어의 첫 글자를 대문자로 변환
    title = title.replace(/\b\w/g, (l) => l.toUpperCase());

    return title || "알 수 없는 제목";
  }

  static generateId(url) {
    // URL 기반의 간단한 ID 생성
    return Buffer.from(url).toString("base64").substring(0, 16);
  }

  static getDefaultThumbnail(extension) {
    // 파일 타입에 따른 기본 썸네일 반환
    const thumbnails = {
      ".mp3": "https://cdn-icons-png.flaticon.com/512/2611/2611282.png",
      ".wav": "https://cdn-icons-png.flaticon.com/512/8263/8263222.png",
      ".flac": "https://cdn-icons-png.flaticon.com/512/8300/8300336.png",
      ".ogg": "https://cdn-icons-png.flaticon.com/512/8744/8744689.png",
      ".m4a": "https://cdn-icons-png.flaticon.com/512/730/730939.png",
    };

    return thumbnails[extension] || "https://cdn-icons-png.freepik.com/512/3871/3871560.png";
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
