// wawoff2 는 타입을 싣지 않는다. 글꼴 스크립트가 쓰는 둘만 적는다
declare module "wawoff2" {
  export function compress(font: Uint8Array): Promise<Uint8Array>;
  export function decompress(font: Uint8Array): Promise<Uint8Array>;
}
