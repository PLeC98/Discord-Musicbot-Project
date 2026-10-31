// 화면에 쓰는 길이, 크기 표기. 값이 없을 때의 문구처럼 위치마다 다른 것은 부르는 쪽이 넘긴다

const pad = (n: number) => String(n).padStart(2, "0");

/** 초 단위 길이를 H:MM:SS 또는 M:SS 로. 값이 없거나 0 이면 unknown */
function formatDuration(seconds: number | string | null | undefined, unknown = "0:00") {
  if (!seconds || seconds === 0) return unknown;

  const totalSeconds = Math.floor(Number(seconds) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(remainingSeconds)}`;
  return `${minutes}:${pad(remainingSeconds)}`;
}

/** 밀리초 길이를 H:MM:SS 또는 M:SS 로 */
function formatMs(ms: number) {
  return formatDuration(ms / 1000);
}

/**
 * 길이를 말로. "3일 4시간 5분", "1시간 5분", "45초". 0인 단위는 빼고, 다 0이면 가장 작은 단위로 "0분", "0초".
 * days: 하루가 넘으면 일로 묶는다(끄면 시간이 24를 넘는다). withSeconds: 하루가 안 되면 초까지 본다
 */
function formatSpan(seconds: number, { days = true, withSeconds = false }: { days?: boolean; withSeconds?: boolean } = {}) {
  const total = Math.floor(seconds);
  const d = days ? Math.floor(total / 86400) : 0;
  const units: Array<[number, string]> = [
    [d, "일"],
    [Math.floor((total - d * 86400) / 3600), "시간"],
    [Math.floor((total % 3600) / 60), "분"],
  ];
  const showSeconds = withSeconds && d === 0;
  if (showSeconds) units.push([total % 60, "초"]);
  const parts = units.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`);
  if (parts.length) return parts.join(" ");
  return showSeconds ? "0초" : "0분";
}

const BYTE_UNITS = [
  ["TB", 1024 ** 4],
  ["GB", 1024 ** 3],
  ["MB", 1024 ** 2],
  ["KB", 1024],
] as const;

/** 바이트 크기에 맞는 단위(1024 배씩, KB 아래로는 내리지 않는다). 수를 몇 자리로 쓸지는 부르는 쪽이 정한다. per: 그 단위가 몇 바이트인지 */
function byteUnit(bytes: number) {
  const [unit, per] = BYTE_UNITS.find(([, size]) => bytes >= size) ?? BYTE_UNITS[BYTE_UNITS.length - 1];
  return { n: bytes / per, unit, per };
}

type Scaled = { n: number; unit: string; per: number };

/**
 * 값을 선택한 단위의 글로. pick: 단위 선택(byteUnit, 대시보드의 utils/units), digits: 그 단위에서 소수 자릿수.
 * 반올림한 수가 다음 단위의 경계에 닿으면(999.96 MB/s → "1000.0") 다음 단위로, 자릿수 규칙의 경계를 넘으면(99.96 → "100.0") 넘은 쪽 자릿수로 다시 쓴다
 */
function scaledText(v: number, pick: (v: number) => Scaled, digits: (n: number, unit: string) => number) {
  let s = pick(v);
  const round = (n: number, unit: string) => Number(n.toFixed(digits(n, unit)));
  const up = pick(round(s.n, s.unit) * s.per);
  if (up.unit !== s.unit) s = { ...up, n: v / up.per };
  const n = round(s.n, s.unit);
  return { value: n.toFixed(digits(n, s.unit)), unit: s.unit, per: s.per };
}

/** 바이트를 KB, MB, GB, TB 로. gbDigits: GB, TB 의 소수 자릿수 */
function formatBytes(bytes: number, { gbDigits = 1 }: { gbDigits?: number } = {}) {
  const { value, unit } = scaledText(bytes, byteUnit, (_, u) => (u === "GB" || u === "TB" ? gbDigits : 1));
  return `${value} ${unit}`;
}

export { formatDuration, formatMs, formatSpan, formatBytes, byteUnit, scaledText };
