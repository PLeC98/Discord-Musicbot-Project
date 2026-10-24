// 바깥 프로그램(tasklist · taskkill · powershell · ps)의 출력 글. UTF-8 이 아니면 Windows 콘솔 코드 페이지(OEMCP: 한국어 949 · 일본어 932 등)로 읽는다.
// 그 코드 페이지를 읽을 디코더가 없으면(437 · 850 같은 영어권 OEM, 메시지는 대개 ASCII) latin1 로 읽는다

import { execFileSync } from "node:child_process";
import logger from "./log/logger.ts";
import { messageOf } from "./error-text.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
// 코드 페이지 → WHATWG 인코딩 이름(TextDecoder 가 읽는 것)
const LABELS: Record<number, string> = { 949: "euc-kr", 932: "shift_jis", 936: "gbk", 950: "big5", 866: "ibm866", 874: "windows-874", 1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253", 1254: "windows-1254", 1255: "windows-1255", 1256: "windows-1256", 1257: "windows-1257", 1258: "windows-1258" };

let oem: number | null | undefined;

/** 이 Windows 의 콘솔 코드 페이지. Windows 가 아니거나 읽지 못하면 null. 처음 한 번 읽는다 */
function oemCodePage(): number | null {
  if (oem !== undefined) return oem;
  oem = null;
  if (!IS_WIN) return oem;
  try {
    // chcp 의 글은 언어마다 다르다. 레지스트리 값은 언어와 상관없이 숫자다
    const out = execFileSync("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage", "/v", "OEMCP"], { encoding: "latin1", windowsHide: true, timeout: 5000 });
    const found = /OEMCP\s+REG_SZ\s+(\d+)/.exec(out);
    oem = found ? Number(found[1]) : null;
    if (oem === null) log.warn("콘솔 코드 페이지를 읽지 못했습니다(OEMCP 값 없음). 바깥 프로그램의 오류 글이 깨질 수 있습니다");
  } catch (error) {
    log.warn(`콘솔 코드 페이지를 읽지 못했습니다. 바깥 프로그램의 오류 글이 깨질 수 있습니다: ${messageOf(error)}`);
  }
  return oem;
}

/** 출력 바이트를 글로. codePage: UTF-8 이 아닐 때 쓸 코드 페이지(기본은 이 Windows 의 것) */
function consoleText(bytes: Uint8Array, codePage = oemCodePage()): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    const label = codePage === null ? undefined : LABELS[codePage];
    if (label) {
      try {
        return new TextDecoder(label).decode(bytes);
      } catch {
        // ICU 를 줄여 빌드한 Node 는 그 인코딩을 모른다
      }
    }
    return Buffer.from(bytes).toString("latin1");
  }
}

export { consoleText };
