// 이미지 편집 창의 90도 회전, 좌우 반전(앱 이모지 편집 면, 로그인 배경 편집 창).
// 원본을 시계 방향으로 돌리고(rotate) 그다음 좌우로 뒤집은(flip) "돌린 이미지" 위에서 영역을 다룬다. 봇도 같은 차례로 적용한다.
// 이미지 요소는 원본 그대로 두고 CSS 로 돌려 보인다(움직이는 GIF, WebP, 영상이 그대로 움직인다)

type Rotation = 0 | 90 | 180 | 270;
type Turn = { rotate: Rotation; flip: boolean };
type Size = { width: number; height: number };
type Rect = { x: number; y: number; w: number; h: number };

const NO_TURN: Turn = { rotate: 0, flip: false };

/** 돌린 이미지의 크기(90도, 270도면 가로세로가 바뀐다) */
const turnedSize = (natural: Size, turn: Turn): Size => (turn.rotate % 180 ? { width: natural.height, height: natural.width } : natural);

/**
 * 돌린 이미지 크기 × k 인 상자 안에 원본 이미지 요소를 돌려 놓는 스타일(요소에 absolute, max-w-none 과 함께).
 * CSS transform 은 오른쪽부터 적용돼 "회전 뒤 반전"이 scaleX(-1) rotate() 차례다
 */
function imageStyle(natural: Size, k: number, turn: Turn) {
  const turned = turnedSize(natural, turn);
  return {
    width: `${natural.width * k}px`,
    height: `${natural.height * k}px`,
    left: `${((turned.width - natural.width) * k) / 2}px`,
    top: `${((turned.height - natural.height) * k) / 2}px`,
    transform: `${turn.flip ? "scaleX(-1) " : ""}rotate(${turn.rotate}deg)`,
  };
}

/**
 * 보이는 이미지를 시계 방향으로 90도: 새 회전과, 돌린 이미지 위 영역을 같이 돌린 것. natural 은 원본 크기.
 * 뒤집혀 보이는 중이면 원본은 반대로 돌려야 같은 결과다(반전 뒤 회전 = 반대 회전 뒤 반전)
 */
function turnRight(natural: Size, turn: Turn, rect: Rect): { turn: Turn; rect: Rect } {
  const { height } = turnedSize(natural, turn);
  return { turn: { ...turn, rotate: ((turn.rotate + (turn.flip ? 270 : 90)) % 360) as Rotation }, rect: { x: height - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w } };
}

/** 보이는 이미지를 좌우로 뒤집기: 새 반전과 같이 뒤집은 영역 */
function mirror(natural: Size, turn: Turn, rect: Rect): { turn: Turn; rect: Rect } {
  const { width } = turnedSize(natural, turn);
  return { turn: { ...turn, flip: !turn.flip }, rect: { ...rect, x: width - rect.x - rect.w } };
}

/** 돌린 이미지 위 영역 → 원본 위 영역(같은 단위). 반전을 되돌리고 회전을 되돌린다 */
function toSource(rect: Rect, natural: Size, turn: Turn): Rect {
  const { width: W, height: H } = natural;
  const x = turn.flip ? turnedSize(natural, turn).width - rect.x - rect.w : rect.x;
  const { y, w, h } = rect;
  if (turn.rotate === 90) return { x: y, y: H - x - w, w: h, h: w };
  if (turn.rotate === 180) return { x: W - x - w, y: H - y - h, w, h };
  if (turn.rotate === 270) return { x: W - y - h, y: x, w: h, h: w };
  return { x, y, w, h };
}

/** 원본 위 영역 → 돌린 이미지 위 영역(toSource 의 반대) */
function fromSource(rect: Rect, natural: Size, turn: Turn): Rect {
  const { width: W, height: H } = natural;
  const { x, y, w, h } = rect;
  const turned = turn.rotate === 90 ? { x: H - y - h, y: x, w: h, h: w } : turn.rotate === 180 ? { x: W - x - w, y: H - y - h, w, h } : turn.rotate === 270 ? { x: y, y: W - x - w, w: h, h: w } : { x, y, w, h };
  return turn.flip ? { ...turned, x: turnedSize(natural, turn).width - turned.x - turned.w } : turned;
}

export { NO_TURN, turnedSize, imageStyle, turnRight, mirror, toSource, fromSource };
export type { Rotation, Turn, Size, Rect };
