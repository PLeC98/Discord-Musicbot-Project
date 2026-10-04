// 화면에 쓰는 길이 · 크기 표기. 값이 없을 때의 문구처럼 자리마다 다른 것은 부르는 쪽이 넘긴다

const pad = (n: number) => String(n).padStart(2, "0");

/** 초 단위 길이를 H:MM:SS 또는 M:SS 로. 값이 없거나 0 이면 unknown */
function formatDuration(seconds: number | string | null | undefined, unknown = "0:00") {
  if (!seconds || seconds === 0) return unknown;

  // 부동소수점 오류를 피하도록 정수로 처리
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
 * 길이를 말로. "3일 4시간 5분" · "1시간 5분" · "45초". 0인 단위는 빼고, 다 0이면 가장 작은 단위로 "0분" · "0초".
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

/** 바이트를 KB · MB · GB 로. gbDigits: GB 의 소수 자릿수 */
function formatBytes(bytes: number, { gbDigits = 1 }: { gbDigits?: number } = {}) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(gbDigits)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export { formatDuration, formatMs, formatSpan, formatBytes };
