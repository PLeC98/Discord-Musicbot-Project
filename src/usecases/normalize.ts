// 볼륨 정규화 켜기, 끄기(디스코드 /normalize, 대시보드 서버 설정). 판정과 처리는 여기서, 결과를 어떻게 알릴지는 입구가 정한다.
// 볼륨처럼 듣는 소리를 바꾸는 DJ 조작이다(checkControl: DJ, 봇이 음성 채널에 있으면 같은 채널). 봇이 음성 채널에 없어도 바꿀 수 있다.
// 재생은 프레임마다 설정을 읽으므로(store/guild-settings 의 resolveNormalize) 바꾸면 지금 곡부터 따라간다.

import type { Guild, GuildMember } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player", sub: "normalize" });
import * as guildSettings from "../store/guild-settings.ts";
import * as playerEvents from "../player/events.ts";
import type { Code } from "../rules/problems.ts";
import { checkControl, type PermissionDenied } from "./permissions.ts";

type NormalizeRefusal = PermissionDenied | Extract<Code, "settings-save-failed">;
/** on: 바꾼 뒤의 상태, already: 이미 그 상태였다 */
type NormalizeResult = { ok: true; on: boolean; already: boolean } | { ok: false; code: NormalizeRefusal };

/** 이 서버의 볼륨 정규화 켜짐 여부 */
const normalizeOn = (guildId: string) => guildSettings.resolveNormalize(guildId);

/** 그 사람이 지금 바꿀 수 없는 까닭. 되면 null(대시보드가 바꾸기 전에 보여 준다) */
const normalizeRefusal = (member: GuildMember): Promise<PermissionDenied | null> => checkControl(member);

async function setNormalize({ guild, member }: { guild: Guild; member: GuildMember }, on: boolean): Promise<NormalizeResult> {
  const denied = await normalizeRefusal(member);
  if (denied) return { ok: false, code: denied };
  if (normalizeOn(guild.id) === on) return { ok: true, on, already: true };
  if (!(await guildSettings.setNormalize(guild.id, on))) return { ok: false, code: "settings-save-failed" };
  log.info(`볼륨 정규화 ${on ? "켬" : "끔"}: ${guild.name} | 실행 ${member.user.tag}`);
  playerEvents.touched(guild.id);
  return { ok: true, on, already: false };
}

export { normalizeOn, normalizeRefusal, setNormalize };
export type { NormalizeResult, NormalizeRefusal };
