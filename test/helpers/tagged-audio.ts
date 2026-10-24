// 그림 · 태그가 붙은 MP3 시료(ffmpeg 로 만든다). ffmpeg 가 없으면 null 이라 부르는 시험이 건너뛴다.
// 파일 태그 그림을 기억 모듈(sources/embedded-art)에 넣어 두는 것까지(remember)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";
import * as embeddedArt from "../../src/sources/embedded-art.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";

let made: Promise<Buffer | null> | null = null;

function run(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-loglevel", "error", ...args], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(false);
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/** 600×600 그림 · 제목 "태그 제목" 이 붙은 3초 MP3 */
function taggedMp3(): Promise<Buffer | null> {
  made ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-tagged-"));
    try {
      const cover = path.join(dir, "c.jpg");
      const mp3 = path.join(dir, "a.mp3");
      const ok = (await run(["-f", "lavfi", "-i", "testsrc2=s=600x600:d=1", "-frames:v", "1", "-y", cover])) && (await run(["-f", "lavfi", "-i", "sine=duration=3", "-i", cover, "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-disposition:v", "attached_pic", "-metadata", "title=태그 제목", "-y", mp3]));
      return ok ? fs.readFileSync(mp3) : null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })();
  return made;
}

/** 이 주소의 음원 파일 태그 · 그림을 기억 모듈에 넣어 둔다. 시료를 만들 수 없으면 false */
async function remember(url: string): Promise<boolean> {
  const mp3 = await taggedMp3();
  if (!mp3) return false;
  await embeddedArt.readFromBody(audioKeyOf(url)!, url, Readable.from([mp3]));
  return true;
}

export { taggedMp3, remember };
