// 화면 스크립트보다 먼저 도는 테마 준비(index.html 머리). 화면 스크립트를 내려받아 실행하기 전까지 브라우저 기본 흰 바탕이 보이지 않게,
// 밝기 모드와 지난번에 칠한 바탕색을 먼저 깐다. CSP가 인라인 스크립트를 막아 같은 출처(origin)의 파일로 둔다.
// 저장 키와 값은 src/theme/theme.ts가 쓰는 것과 같다(theme:mode, theme:surface). 기억이 없으면 style.css의 기본 바탕색
{
  const root = document.documentElement;
  let mode = null;
  let surface = null;
  try {
    mode = localStorage.getItem("theme:mode");
    surface = JSON.parse(localStorage.getItem("theme:surface") ?? "null");
  } catch {
    // 저장소를 막아 둔 브라우저거나 망가진 값이면 기본(어둡게)
  }
  const dark = mode === "light" ? false : mode === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
  const theme = dark ? "dark" : "light";
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const hex = surface && typeof surface === "object" ? surface[theme] : null;
  if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex)) root.style.setProperty("--md-surface", hex);
}
