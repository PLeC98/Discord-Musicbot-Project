// 자동재생 소스가 내는 곡 한 줄. 어느 칸이 찼는지가 뒤의 처리를 정한다(sources/index 의 설명).

type Candidate = {
  title: string;
  /** 같은 곡을 두 번 내지 않게 가르는 값 */
  sourceKey: string;
  artist?: string;
  durationSec?: number;
  audioUrl?: string;
  youtubeUrl?: string;
  thumbnail?: string | null;
  /** 곡이 어디 것인가. 있으면 유튜브 영상은 소리만 댄다 */
  sourceUrl?: string;
  platform?: string;
  /** 검색 결과라 제목을 못 믿는다. AI 보조가 이것만 판정한다 */
  fromSearch?: boolean;
};

export type { Candidate };
