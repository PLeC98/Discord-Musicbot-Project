import { ref } from "vue";

// 사이드바 상태 — 네비바의 햄버거 버튼(App.vue)과 사이드바(ServerSidebar.vue)가 공유.
// 유튜브식 3단계:
//   좁음(<md)   : 레일 없음, 햄버거 → 오버레이 드로어
//   중간(md~lg) : 미니 레일 상주, 햄버거 → 오버레이 드로어
//   넓음(lg+)   : 햄버거 → 인라인 접힘/펼침 (콘텐츠를 밀어냄), localStorage로 영속
const STORAGE_KEY = "sidebar:collapsed";
const WIDE = "(min-width: 64rem)"; // Tailwind lg

export const sidebarCollapsed = ref(localStorage.getItem(STORAGE_KEY) === "1"); // 넓은 화면 전용 설정
export const drawerOpen = ref(false); // 좁은/중간 화면 오버레이 — 세션 한정, 저장하지 않음

export function toggleSidebar() {
  if (window.matchMedia(WIDE).matches) {
    sidebarCollapsed.value = !sidebarCollapsed.value;
    localStorage.setItem(STORAGE_KEY, sidebarCollapsed.value ? "1" : "0");
  } else {
    drawerOpen.value = !drawerOpen.value;
  }
}

export function closeDrawer() {
  drawerOpen.value = false;
}

// 드로어가 열린 채 창을 넓히면 (lg 진입) 드로어 모드 자체가 사라지므로 정리
window.matchMedia(WIDE).addEventListener("change", (e) => {
  if (e.matches) drawerOpen.value = false;
});
