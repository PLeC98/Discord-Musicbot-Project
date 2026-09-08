// 재생 시간 표기 (m:ss / h:mm:ss) — 서버 화면과 전역 재생 바가 같은 형식을 써야 하므로 한곳에 둔다.
export function fmtTime(sec) {
  if (!sec && sec !== 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
