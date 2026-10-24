// 소리 입력 하나(소스)가 온전히 끝났는지. 곡 끝 판정이 본다.
// 소스마다 하나다. 캐시로 갈아타면 재생이 가리키는 것이 새 소스의 것으로 바뀌고, 버린 소스에 늦게 오는 일은 새 소스를 물들이지 않는다.

type Exiting = { once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown };

class InputHealth {
  kind: string; // 입력 구분(로그용). 파일 · HLS · 청크 · 직접 링크 등
  broken: string | null = null; // 처음 깨진 까닭. 온전하면 null
  exitCode: number | null = null; // ffmpeg 종료 코드. 신호로 죽었으면 -1, 아직 살아 있으면 null
  detail: () => string | null = () => null; // 끊겼을 때 남길 입력 상태(청크 스트림이 이어받는 중이었나 등)

  constructor(kind: string) {
    this.kind = kind;
  }

  /** 깨졌다. 먼저 온 까닭을 지킨다 */
  mark(why: string) {
    this.broken ??= why;
  }

  /** ffmpeg 가 끝나면 종료 코드를 적는다. 0 이 아니면 깨진 것이다 */
  watch(child: Exiting) {
    child.once("exit", (code, signal) => {
      this.exitCode = code === null && signal ? -1 : code;
      if (this.exitCode !== 0) this.mark(`ffmpeg 종료 코드 ${code ?? signal ?? "없음"}`);
    });
    return this;
  }
}

export { InputHealth };
