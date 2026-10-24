// Vite 가 처리하는 가져오기(CSS 등)의 타입
/// <reference types="vite/client" />

// hls.js 의 가벼운 빌드(자막 · 다른 오디오 · DRM 을 뺀 것)는 타입을 따로 싣지 않는다. 전체 빌드와 같은 형태다
declare module "hls.js/light" {
  export { default } from "hls.js";
}
