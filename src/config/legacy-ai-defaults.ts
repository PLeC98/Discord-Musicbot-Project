// 예전에 함께 싣던 AI 기본값(줄 형식 · 판정 기준). 저장된 문서가 이것과 글자까지 같으면 운영자가 고친 적이 없는 것이라
// 기동 때 지금 기본값으로 바꾼다(config/ai-upgrade). 고친 것은 건드리지 않는다. 비교에만 쓰므로 글자를 고치지 않는다.
//
// 줄 형식: 한글 자리표시자 시절 · 영어 이름으로 바꾼 뒤의 한국어 줄
// 판정 기준: 장르를 한국어 이름으로 적던 것 · 영어 식별자로 바꾼 뒤의 한국어 지시문

const LEGACY_LINE_FORMATS: readonly string[] = ["{{번호}}. 장르={{장르}} 길이={{길이분}}분 제목={{제목}}", "{{index}}. 장르={{genre}} {{#if-exist {{duration}}}}길이={{duration::m}}분 {{/}}제목={{title}}"];

const LEGACY_PROMPTS: readonly string[] = [
  '유튜브 검색 결과가 디스코드 음악봇의 자동재생에 쓸 만한지 판정한다.\n\nsong — 이 영상이 **곡 하나**를 담고 있는가?\n  true : 뮤직비디오 · 공식 오디오 · 라이브 한 곡 · 애니 오프닝 한 곡\n         클래식 교향곡이나 소나타는 20~40분이어도 작품 하나이므로 true\n  false: 여러 곡을 이어 붙인 것(믹스 · 플레이리스트 · 메들리 · 컴필레이션 · 앨범 전곡 · 라디오)\n         음악이 아닌 것(강의 · 리뷰 · 예고편 PV · 랭킹영상 · 동요 모음)\n\nfits — 요청한 장르가 맞는가?\n  아티스트와 곡을 알고 판단한다. 제목에 장르 이름이 들어 있어도 실제 장르가 다르면 false.\n  장르가 "랜덤"이면 음악이기만 하면 true.\n\n예)\n  장르=록 제목=System Of A Down - Toxicity (Official HD Video) → song=true, fits=true\n  장르=록 제목=LMFAO - Party Rock Anthem → song=true, fits=false (제목에 rock이 있지만 일렉트로닉이다)\n  장르=팝 제목=Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift → song=false (여러 곡)\n  장르=클래식 제목=Beethoven: Symphony No. 7 (41분) → song=true, fits=true (작품 하나)\n  장르=로파이 제목=Maroon 5 - Girls Like You → song=true, fits=false (로파이가 아니다)\n\nJSON 배열로만 답한다. 설명하지 않는다.\n[{"n":1,"song":true,"fits":false}, ...]',
  '유튜브 검색 결과가 디스코드 음악봇의 자동재생에 쓸 만한지 판정한다.\n\nsong — 이 영상이 **곡 하나**를 담고 있는가?\n  true : 뮤직비디오 · 공식 오디오 · 라이브 한 곡 · 애니 오프닝 한 곡\n         클래식 교향곡이나 소나타는 20~40분이어도 작품 하나이므로 true\n  false: 여러 곡을 이어 붙인 것(믹스 · 플레이리스트 · 메들리 · 컴필레이션 · 앨범 전곡 · 라디오)\n         음악이 아닌 것(강의 · 리뷰 · 예고편 PV · 랭킹영상 · 동요 모음)\n\nfits — 요청한 장르가 맞는가?\n  아티스트와 곡을 알고 판단한다. 제목에 장르 이름이 들어 있어도 실제 장르가 다르면 false.\n  장르가 "random"이면 음악이기만 하면 true.\n\n예)\n  장르=rock 제목=System Of A Down - Toxicity (Official HD Video) → song=true, fits=true\n  장르=rock 제목=LMFAO - Party Rock Anthem → song=true, fits=false (제목에 rock이 있지만 일렉트로닉이다)\n  장르=pop 제목=Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift → song=false (여러 곡)\n  장르=classical 제목=Beethoven: Symphony No. 7 (41분) → song=true, fits=true (작품 하나)\n  장르=lo-fi 제목=Maroon 5 - Girls Like You → song=true, fits=false (lo-fi 가 아니다)\n\nJSON 배열로만 답한다. 설명하지 않는다.\n[{"n":1,"song":true,"fits":false}, ...]',
];

/** 프롬프트 문서의 목록 위치(옛 한글 이름 · 지금 이름) */
const LEGACY_LIST_MARKS: readonly string[] = ["{{목록}}", "{{list}}"];

export { LEGACY_LINE_FORMATS, LEGACY_PROMPTS, LEGACY_LIST_MARKS };
