// sRGB ↔ OKLab. 색 역할 옮기기(blend) · 배경 그림의 밝기 띠(art)가 같이 쓴다. sRGB 는 0~1, L 은 0~1

type Lab = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB(0~1) → OKLab */
function rgbToLab(red: number, green: number, blue: number): Lab {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → sRGB(0~1). 범위 밖으로 나간 값은 부른 쪽이 자른다 */
function labToRgb(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

export { labToRgb, rgbToLab };
export type { Lab };
