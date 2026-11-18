// 봇 정보(/api/bot) 읽기. 화면 틀(App)과 로그인 화면이 쓴다.
// 봇이 디스코드에 로그인하기 전(기동 직후, 다시 시작 중)이면 이름과 프로필 이미지가 비어 온다. 이름이 올 때까지 다시 읽어 그때마다 onInfo로 넘긴다.
// 프로필 이미지가 없는 봇도 있어 준비 여부는 이름으로 본다

import axios from "axios";
import type { BotInfo } from "../../../src/dashboard/contract/identity.ts";

/** 다시 읽는 간격(ms)과 횟수(합쳐 1분) */
const RETRY_MS = 2000;
const RETRIES = 30;

/**
 * 읽어서 onInfo로 넘긴다. 첫 읽기가 실패하면 거부된다(호출부가 오프라인 표시 등을 한다).
 * 봇이 준비 전이면 뒤에서 다시 읽고, 그 읽기의 실패는 조용히 넘긴다
 */
async function followBotInfo(onInfo: (info: BotInfo) => void, { quietSession = false, left = RETRIES }: { quietSession?: boolean; left?: number } = {}): Promise<void> {
  const { data } = await axios.get<BotInfo>("/api/bot", { quietSession });
  onInfo(data);
  if (data.name !== null || left <= 0) return;
  setTimeout(() => void followBotInfo(onInfo, { quietSession, left: left - 1 }).catch(() => undefined), RETRY_MS);
}

export { followBotInfo };
