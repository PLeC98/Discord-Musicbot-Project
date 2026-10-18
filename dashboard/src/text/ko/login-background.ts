// 운영자 패널: 디스플레이 탭의 로그인 배경 카드 · 변경 팝업 · 편집 창 · 시간 막대

import type { LoginBackgroundCodec, LoginBackgroundStage } from "../../../../src/dashboard/contract/login-background.ts";
import { josa } from "../../../../src/rules/josa.ts";

/** 만드는 단계(운영자에게 보이는 말) */
const stage: Record<LoginBackgroundStage, string> = {
  receive: "영상 다운로드 중",
  preview: "프리뷰 준비 중",
  strip: "스프라이트 준비 중",
  highRes: "영상 다운로드 중",
  thumb: "썸네일 제작 중",
  stills: "이미지 변환 중",
  tones: "장면 색 추출 중",
  h264: "인코딩 중(1/4)",
  encode: "인코딩 중(3/4)",
  drop: "마무리하는 중",
};

/** 카드 */
const card = {
  title: "로그인 배경",
  desc: "로그인 화면을 보는 기기에 따라 화질과 효과가 달라질 수 있어요.",
  none: "로그인 화면에 봇 프로필 이미지를 쓰고 있어요.",
  /** 새 배경을 만드는 동안 로그인 화면이 보이는 것. 썸네일 전에는 지금 배경(없으면 봇 프로필 이미지) 그대로 */
  loginMaking: "새 배경을 만드는 중이에요.",
  loginThumb: "썸네일을 적용했어요. 영상을 준비 중이에요.",
  loginPartial: "저화질 영상을 적용했어요. 고화질 영상을 준비 중이에요.",
  stage,
  queued: "순서대로 인코딩 중이에요.",
  resumed: "중단된 인코딩을 이어서 하고 있어요.",
  /** 편집을 마치기 전(받기 · 프리뷰 · 스프라이트 · 편집 대기) · 편집을 적용한 뒤(인코딩 · 대기) */
  cancelEdit: "편집 취소",
  cancelEditTip: "올린 배경을 버려요.",
  cancelEncode: "인코딩 취소",
  cancelEncodeTip: "만들던 배경을 버리고 이전 배경으로 돌아가요.",
  /** 지금 배경의 정보. seconds 는 영상의 구간 길이 */
  info: (width: number, height: number, seconds: number | null, size: string) => [`${width} × ${height}`, ...(seconds === null ? [] : [`${Math.round(seconds)}초`]), size].join(" · "),
  add: "추가하기",
  change: "변경",
  edit: "이어서 편집하기",
  clear: "로그인 배경 삭제(기록은 남아요)",
  positionX: "좌우",
  positionY: "상하",
  blur: "블러",
  opacity: "배경 불투명도",
  immersive: "몰입형 테마 색상",
  immersiveTip: "영상의 장면이 바뀔 때 테마 색을 그 장면의 색으로 바꿔요.",
  seam: "반복 전환 효과",
  seamTip: "영상이 끝에서 처음으로 돌아갈 때 적용하는 효과예요. 끝과 처음 장면이 다를 때 덜 튀어 보여요.",
  seamKinds: { cut: "없음", freeze: "마지막 프레임 겹치기", cover: "페이드(테마 색)", black: "페이드(검정)", blur: "블러 전환" },
  seamSeconds: (s: number) => `${s}초`,
  seamLength: "효과 길이",
  resetPosition: "위치 초기화",
  resetOptions: "초기화",
  waitingEdit: "완료되지 않은 편집이 있어요.",
  /** 만들다 실패한 배경(까닭은 봇 문장표의 문제 코드 안내) */
  failed: (name: string) => `"${name}"${josa(name, "을")} 만들지 못했어요.`,
  /** 로그인 화면 위에 지금 배경을 띄워 본다 */
  viewLogin: "미리보기",
  closeLogin: "닫기",
  silhouette: "로그인 화면 겹쳐 보기",
  /** 화면 판의 비율 단추 툴팁: 그 비율의 기기(지금 흔한 것 중심) */
  ratioDevices: {
    "16:9": "대부분의 모니터 · 노트북(FHD · QHD · 4K), TV",
    "16:10": "맥북 · 요즘 윈도우 노트북 · 갤럭시 탭",
    "3:2": "서피스",
    "21:9": "울트라와이드 모니터",
    "4:3": "아이패드(가로)",
    "3:4": "아이패드(세로)",
    "9:19.5": "아이폰 · 갤럭시 S",
    "9:20": "픽셀 · 샤오미 등 안드로이드",
    "9:22": "갤럭시 Z 플립",
  } as Record<string, string>,
};

/** 고급 설정(접힘) */
const advanced = {
  title: "고급 설정",
  history: "기록 보관 개수",
  historyTip: "다시 인코딩하지 않고 바로 바꿔 쓸 수 있게 남겨 둘 배경 수예요. 0 이면 지금 배경만 남겨요.",
  maxSize: "최대 용량(GB)",
  maxSizeTip: "사용 중인 배경과 기록을 합친 크기예요. 넘으면 오래 안 쓴 기록부터 지워요. 0 이면 무제한이에요.",
  usedLabel: "사용 중",
  used: (used: string, max: string | null) => (max ? `${used} / ${max}` : `${used} · 무제한`),
  encoders: "인코딩 환경",
  encodersTip: "봇이 시작할 때 이 기기에서 쓸 수 있는 인코더를 확인해 선택해요.",
  /** 코덱 · 인코더 이름(ffmpeg 의 이름 → 보일 이름) */
  codec: { av1: "AV1", vp9: "VP9", h264: "H.264" } satisfies Record<LoginBackgroundCodec, string>,
  encoderName: { libsvtav1: "SVT-AV1", "libvpx-vp9": "libvpx", libopenh264: "OpenH264", h264_nvenc: "NVENC", h264_qsv: "QuickSync", h264_amf: "AMF", h264_vaapi: "VAAPI" } as Record<string, string>,
  use: (name: string, hardware: boolean) => `${name} · ${hardware ? "GPU" : "CPU"}`,
  noEncoder: "만들 수 없어요",
  checking: "확인하는 중…",
  recheck: "다시 확인",
  /** 지금 굽는 것: 단계 · AV1 병렬 단계 · 묶은 코어 · 속도(실시간의 몇 배) */
  bakeTitle: "지금 인코딩",
  bake: (rungs: string, lp: number | null, cores: string, speed: number | null) => [rungs, ...(lp === null ? [] : [`AV1 병렬 단계 ${lp}`]), cores, ...(speed === null ? [] : [`실시간의 ${speed < 1 ? speed.toFixed(2) : speed.toFixed(1)}배`])].join(" · "),
  bakeTip: "봇 상태 탭에서 인코딩하는 동안의 메모리와 이벤트 루프 지연을 볼 수 있어요.",
  cores: (bound: number | null, total: number) => (bound === null ? `코어 ${total}개(지정 안 함)` : `코어 ${bound} / ${total}`),
};

/** 변경 팝업: 파일 업로드 · 링크로 추가 · 기록 */
const source = {
  title: "로그인 배경",
  free: (size: string) => `남은 저장 공간 ${size}`,
  fromFile: "파일 업로드",
  fileHint: "이미지 · 영상 · 움짤",
  fileHintTip: "투명한 부분은 지원하지 않아요.",
  fromLink: "링크로 추가",
  linkLabel: "주소",
  linkPlaceholder: "https://…",
  linkFetch: "가져오기",
  linkBad: "http · https 로 시작하는 주소를 입력해 주세요.",
  uploadStep: "원본 다운로드",
  uploading: "업로드 중",
  queued: "인코딩 대기",
  preparing: "편집 창 불러오는 중",
  historyTitle: "기록",
  historyDesc: (n: number) => `최근 배경 ${n}개까지 다시 만들지 않고 바로 쓸 수 있어요.`,
  inUse: "사용 중",
  removeOne: "기록에서 삭제",
  kind: { image: "이미지", video: "영상" },
  from: { upload: "업로드", youtube: "유튜브", link: "링크" },
  failed: "실패",
};

/** 편집 창 */
const edit = {
  title: "배경 편집하기",
  start: "구간 시작",
  end: "구간 끝",
  thumbMark: "썸네일 장면",
  play: "재생",
  pause: "일시정지",
  range: (from: string, to: string, seconds: number) => `${from} – ${to}(${Math.round(seconds)}초)`,
  useAsThumb: "이 장면을 썸네일로",
  thumbHint: "썸네일을 선택하지 않으면 구간 시작 장면을 써요.",
  picked: (width: number, height: number) => `선택한 영역 ${width} × ${height}`,
  /** 예상 파일 크기(세트 하나) */
  estimate: (size: string) => `예상 파일 크기 약 ${size}`,
  /** 예상 인코딩 시간(이 기기에서 잰 굽는 속도 × 구간 길이) */
  encodeTime: (minutes: number) => (minutes < 1 ? "예상 인코딩 시간 1분 이내" : `예상 인코딩 시간 약 ${Math.round(minutes)}분`),
  counting: "예상 파일 크기 계산 중…",
  /** 유튜브는 480p 로 잰 어림이다(고해상도는 적용한 뒤에 받는다) */
  rough: "고화질 영상을 받기 전이라 대략적인 값이에요",
  evict: (n: number) => `최대 용량을 넘을 수 있어 오래된 기록 ${n}개를 지우게 될 수 있어요.`,
  overAlone: "이 배경 하나만으로 최대 용량을 넘을 수 있어요. 만들면 기록을 모두 지우고 이것만 남겨요.",
  reset: "재설정",
  zoom: "화면 확대",
  use: "적용하기",
};

/** 편집 창의 시간 막대 */
const timeline = {
  back10: "10초 전",
  backFrame: "1프레임 전",
  play: "재생",
  pause: "일시정지",
  nextFrame: "1프레임 뒤",
  next10: "10초 뒤",
  useAsThumb: "썸네일 설정",
  markIn: "시작점",
  markInTip: "재생 위치를 구간 시작점으로(I)",
  markOut: "끝점",
  markOutTip: "재생 위치를 구간 끝점으로(O)",
  thumbMark: "썸네일",
  start: "시작",
  end: "끝",
  length: (seconds: number) => `구간 ${seconds.toFixed(1)}초`,
  loop: "구간 반복 재생",
  loopOn: "구간 반복 재생 켜짐(끄면 구간 끝에서 멈춰요)",
  loopOff: "구간 반복 재생 꺼짐",
  zoom: "확대",
};

/** 알림 */
const notice = {
  applied: "로그인 배경을 적용했어요",
  cleared: "로그인 배경을 삭제했어요",
  removed: "기록에서 로그인 배경을 삭제했어요",
  canceled: "로그인 배경 적용을 취소했어요",
  failed: "로그인 배경을 바꾸지 못했어요.",
};

export { advanced, card, source, edit, timeline, notice };
