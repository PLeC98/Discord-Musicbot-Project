import { playCommand } from "./play.ts";
import { checkControl, checkSummon } from "../src/usecases/permissions.ts";

// 우선 추가(대기열 맨 앞 삽입)는 재생 순서를 바꾸는 조작. DJ 계층 필요
const exported = playCommand({
  name: "playfirst",
  description: "Add a song to the front of the queue",
  ko: "대기열 맨 앞에 곡을 넣어요",
  permission: async (member) => (await checkControl(member)) || checkSummon(member),
  insertFirst: true,
});
export default exported;
