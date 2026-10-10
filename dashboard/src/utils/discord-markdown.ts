// 디스코드 임베드 본문(description)이 그리는 마크다운을 HTML 로 옮긴다(공지 미리보기용).
// 블록: 코드 블록 ``` · 인용 > · >>>(그 뒤 전부) · 제목 # ## ### · 작은 글씨 -# · 목록 - * · 번호 목록 1.
// 글 안: 인라인 코드 ` · 굵게 ** · 밑줄 __ · 기울임 * _ · 취소선 ~~ · 스포일러 || · 링크 [글](주소) · 맨 주소 · 시각 <t:초:형식> · 멘션 · 사용자 이모지 · 역슬래시 이스케이프.
// 글은 먼저 HTML 이스케이프하고 만든 태그만 넣는다(v-html 로 그린다)

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 시각 형식(디스코드 한국어 표기에 가깝게)
function timestamp(sec: number, style: string): string {
  const d = new Date(sec * 1000);
  const time = (s: boolean) => d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", ...(s ? { second: "2-digit" } : {}) });
  const date = (long: boolean, weekday = false) => d.toLocaleDateString("ko-KR", long ? { year: "numeric", month: "long", day: "numeric", ...(weekday ? { weekday: "long" } : {}) } : { year: "numeric", month: "2-digit", day: "2-digit" });
  switch (style) {
    case "t":
      return time(false);
    case "T":
      return time(true);
    case "d":
      return date(false);
    case "D":
      return date(true);
    case "F":
      return `${date(true, true)} ${time(false)}`;
    case "s":
      return `${date(false)} ${time(false)}`;
    case "S":
      return `${date(false)} ${time(true)}`;
    case "R": {
      const diff = sec - Date.now() / 1000;
      const rtf = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
      const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
        ["second", 1],
      ];
      for (const [unit, size] of units) if (Math.abs(diff) >= size || unit === "second") return rtf.format(Math.round(diff / size), unit);
      return "";
    }
    default:
      return `${date(true)} ${time(false)}`;
  }
}

/** 글 안의 서식. 코드 조각은 먼저 떼어 두어 그 안은 서식을 보지 않는다 */
function inline(raw: string): string {
  const keep: string[] = [];
  const hold = (html: string) => `\u0000${keep.push(html) - 1}\u0000`;
  // 역슬래시 이스케이프: 서식 기호를 글자 그대로
  let s = raw.replace(/\\([*_~|`\\<>#[\]()-])/g, (_, c: string) => hold(esc(c)));
  s = s.replace(/(`+)([\s\S]+?)\1/g, (_, __, code: string) => hold(`<code class="dmd-code">${esc(code.trim() || code)}</code>`));
  s = esc(s);
  // 링크([글](주소))와 맨 주소. 주소는 http · https 만
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text: string, url: string) => hold(`<a class="dmd-link" href="${url}" target="_blank" rel="noopener">${text}</a>`));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g, (_, pre: string, url: string) => pre + hold(`<a class="dmd-link" href="${url}" target="_blank" rel="noopener">${url}</a>`));
  // 시각 · 멘션 · 사용자 이모지(이스케이프된 꺾쇠)
  s = s.replace(/&lt;t:(-?\d+)(?::([tTdDfFsSR]))?&gt;/g, (_, sec: string, style = "f") => hold(`<span class="dmd-time">${esc(timestamp(Number(sec), style))}</span>`));
  s = s.replace(/&lt;@!?(\d+)&gt;/g, () => hold('<span class="dmd-mention">@사용자</span>'));
  s = s.replace(/&lt;@&amp;(\d+)&gt;/g, () => hold('<span class="dmd-mention">@역할</span>'));
  s = s.replace(/&lt;#(\d+)&gt;/g, () => hold('<span class="dmd-mention">#채널</span>'));
  s = s.replace(/&lt;a?:(\w+):(\d+)&gt;/g, (_, name: string) => hold(`<span class="dmd-emoji">:${name}:</span>`));
  // 굵게 → 밑줄 → 기울임 → 취소선 → 스포일러(겹쳐 쓸 수 있다)
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([\s\S]+?)__/g, "<u>$1</u>");
  s = s.replace(/\*([^*\s](?:[\s\S]*?[^*\s])?)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_([^_\s](?:[\s\S]*?[^_\s])?)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([\s\S]+?)~~/g, "<s>$1</s>");
  s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dmd-spoiler" role="button" tabindex="0">$1</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => keep[Number(i)]);
}

type Block = { kind: "p" | "h1" | "h2" | "h3" | "sub" | "quote" | "ul" | "ol" | "code"; lines: string[] };

// 줄 머리 → 칸 종류와 떼어 낼 머리 길이(위에서부터 처음 맞는 것, 맞는 것이 없으면 문단)
const LINE_KINDS: Array<{ head: RegExp; kind: Block["kind"]; cut: number }> = [
  { head: /^>( |$)/, kind: "quote", cut: 2 },
  { head: /^### /, kind: "h3", cut: 4 },
  { head: /^## /, kind: "h2", cut: 3 },
  { head: /^# /, kind: "h1", cut: 2 },
  { head: /^-# /, kind: "sub", cut: 3 },
  { head: /^\s*[-*] /, kind: "ul", cut: 0 },
  { head: /^\s*\d+\. /, kind: "ol", cut: 0 },
];

/** i 번째 줄에서 여는 코드 칸. 같은 줄에서 닫히면 그 줄만, 아니면 닫는 ``` 까지(여는 줄의 나머지가 낱말 하나면 언어 이름). 닫지 않았으면 null */
function codeBlock(lines: string[], i: number): { block: Block; end: number } | null {
  const rest = lines[i].slice(3);
  const close = rest.indexOf("```");
  if (close >= 0) return { block: { kind: "code", lines: [rest.slice(0, close)] }, end: i };
  const end = lines.findIndex((l, k) => k > i && l.startsWith("```"));
  if (end <= i) return null;
  const body = /^\w*$/.test(rest.trim()) ? [] : [rest];
  return { block: { kind: "code", lines: [...body, ...lines.slice(i + 1, end)] }, end };
}

/** 디스코드 마크다운 → HTML */
export function discordMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const push = (kind: Block["kind"], line: string) => {
    const last = blocks.at(-1);
    if (last && last.kind === kind && (kind === "p" || kind === "quote" || kind === "ul" || kind === "ol")) last.lines.push(line);
    else blocks.push({ kind, lines: [line] });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.startsWith("```") ? codeBlock(lines, i) : null;
    if (code) {
      blocks.push(code.block);
      i = code.end;
      continue;
    }
    if (line.startsWith(">>> ")) {
      for (const rest of [line.slice(4), ...lines.slice(i + 1)]) push("quote", rest);
      break;
    }
    const match = LINE_KINDS.find((one) => one.head.test(line));
    push(match?.kind ?? "p", match ? line.slice(match.cut) : line);
  }
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "code":
          return `<pre class="dmd-pre"><code>${esc(b.lines.join("\n"))}</code></pre>`;
        case "quote":
          return `<blockquote class="dmd-quote">${b.lines.map(inline).join("<br>")}</blockquote>`;
        case "h1":
        case "h2":
        case "h3":
          return `<div class="dmd-${b.kind}">${inline(b.lines[0])}</div>`;
        case "sub":
          return `<div class="dmd-sub">${inline(b.lines[0])}</div>`;
        case "ul":
        case "ol": {
          const items = b.lines.map((l) => {
            const depth = Math.min(2, Math.floor((/^\s*/.exec(l)?.[0].length ?? 0) / 2));
            const content = l.replace(/^\s*(?:[-*]|\d+\.) /, "");
            return `<li style="margin-left:${depth * 1.25}rem">${inline(content)}</li>`;
          });
          const start = b.kind === "ol" ? Number(/\d+/.exec(b.lines[0])?.[0] ?? 1) : 1;
          return b.kind === "ol" ? `<ol class="dmd-ol" start="${start}">${items.join("")}</ol>` : `<ul class="dmd-ul">${items.join("")}</ul>`;
        }
        default:
          return `<div>${b.lines.map(inline).join("<br>")}</div>`;
      }
    })
    .join("");
}
