// 자동재생 소스가 내는 곡 한 줄. 어느 필드가 찼는지가 뒤의 처리를 정한다(sources/index의 설명).

type Candidate = {
  title: string;
  /** 같은 곡을 두 번 내지 않게 구분하는 값 */
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
  /** 음원이 있어야 할 곡인데 쓸 음원이 없다(AnimeThemes의 대사가 겹친 판본뿐인 곡). 유튜브에서 확실한 풀버전을 찾을 때만 튼다(음원 후보와 같은 기준) */
  strict?: boolean;
};

export type { Candidate };
