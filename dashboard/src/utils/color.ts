// 색 고르기(ColorPicker)의 계산. 색상(h 0~360) · 채도(s 0~1) · 밝기(v 0~1) ↔ #RRGGBB

export type Hsv = { h: number; s: number; v: number };

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (value: string) => HEX.test(value);

/** #RRGGBB → HSV. 무채색(s = 0)이나 검정(v = 0)은 색상이 없어 0 이다 */
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  let h = 0;
  if (span) {
    if (max === r) h = ((g - b) / span) % 6;
    else if (max === g) h = (b - r) / span + 2;
    else h = (r - g) / span + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? span / max : 0, v: max };
}

/** HSV → #RRGGBB(대문자) */
export function hsvToHex({ h, s, v }: Hsv): string {
  const at = (n: number) => {
    const k = (n + h / 60) % 6;
    const channel = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(channel * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${at(5)}${at(3)}${at(1)}`.toUpperCase();
}
