// 로그 문구: 사운드클라우드(곡 찾기와 재생 양쪽의 줄에 값으로 들어간다). yt-dlp 출력 읽기, 재생할 형식 고르기

const soundcloud = {
  lookupNotJson: ({ shape }: { shape: string }) => `사운드클라우드 곡 찾기: yt-dlp 출력이 JSON 객체가 아님 | ${shape}`,
  hlsNoMp3: () => `이 ffmpeg는 HLS를 열지 못하고, 이 곡에는 mp3가 없음`,
  streamNotJson: ({ shape }: { shape: string }) => `사운드클라우드 재생용 스트림: yt-dlp 출력이 JSON 객체가 아님 | ${shape}`,
  /** title: 곡 제목이나 주소(없으면 null) */
  previewOnly: ({ title }: { title: string | null }) => `미리듣기만 열린 곡: ${title ?? "없음"}`,

  lookupNoPageUrl: ({ id }: { id: string | number | null }) => `사운드클라우드 곡 찾기: yt-dlp 곡 정보에 페이지 URL이 없음 | id=${id ?? "없음"}`,
  streamNoUrl: ({ formatId }: { formatId: string | null }) => `사운드클라우드 재생용 스트림: yt-dlp 응답에 스트림 URL이 없음 | format_id=${formatId ?? "없음"}`,
};

export { soundcloud };
