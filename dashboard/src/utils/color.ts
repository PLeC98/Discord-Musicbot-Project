// 색 선택(ColorPicker)의 계산. #RRGGBB ↔ RGB(0~255) ↔ HSV(색상 h 0~360 · 채도 s 0~1 · 밝기 v 0~1)

export type Rgb = { r: number; g: number; b: number };
export type Hsv = { h: number; s: number; v: number };

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (value: string) => HEX.test(value);

/** 입력한 글을 #RRGGBB(대문자)로. # 은 없어도 되고 세 자리(#RGB)는 늘린다. 색이 아니면 null */
export function parseHex(typed: string): string | null {
  const body = typed.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(body)) return `#${[...body].map((c) => c + c).join("")}`.toUpperCase();
  return /^[0-9a-fA-F]{6}$/.test(body) ? `#${body}`.toUpperCase() : null;
}

export function hexToRgb(hex: string): Rgb {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return { r, g, b };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** 무채색(s = 0)이나 검정(v = 0)은 색상이 없어 0 이다 */
export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [R, G, B] = [r, g, b].map((n) => n / 255);
  const max = Math.max(R, G, B);
  const span = max - Math.min(R, G, B);
  let h = 0;
  if (span) {
    if (max === R) h = ((G - B) / span) % 6;
    else if (max === G) h = (B - R) / span + 2;
    else h = (R - G) / span + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? span / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const at = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return { r: at(5), g: at(3), b: at(1) };
}

export const hexToHsv = (hex: string) => rgbToHsv(hexToRgb(hex));
/** HSV → #RRGGBB(대문자) */
export const hsvToHex = (hsv: Hsv) => rgbToHex(hsvToRgb(hsv));

/** 새 색의 HSV. 검정이면 지금 색상 · 채도를, 무채색이면 지금 색상을 남긴다(판의 핸들이 튀지 않게) */
export function keepHue(next: Hsv, now: Hsv): Hsv {
  if (!next.v) return { h: now.h, s: now.s, v: 0 };
  if (!next.s) return { ...next, h: now.h };
  return next;
}
