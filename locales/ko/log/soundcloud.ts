// 로그 문구: 사운드클라우드(곡 찾기와 재생 양쪽의 줄에 값으로 들어간다). yt-dlp 출력 읽기, 재생할 형식 고르기

const soundcloud = {
  lookupNotJson: ({ shape }: { shape: string }) => `사운드클라우드 곡 찾기: yt-dlp 출력이 JSON 객체가 아님 | ${shape}`,
  hlsNoMp3: () => `이 ffmpeg는 HLS를 열지 못하고, 이 곡에는 mp3가 없음`,
  streamNotJson: ({ shape }: { shape: string }) => `사운드클라우드 재생용 스트림: yt-dlp 출력이 JSON 객체가 아님 | ${shape}`,
  previewOnly: ({ title }: { title: string }) => `미리듣기만 열린 곡: ${title}`,
};

export { soundcloud };
