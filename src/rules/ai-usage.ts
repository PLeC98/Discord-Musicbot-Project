// AI 사용량 통계의 계산(contract/ai-log 의 AiUsageReport). 요청 한 행씩의 가벼운 기록을 기간 · 날짜 · 모델 · 출처 · 서버로 묶는다.
// 봇의 통계 경로와 더미가 같이 부른다. Node 없는 모듈이다.

import type { AiLogSource, AiUsageBucket, AiUsagePeriod, AiUsageReport } from "../dashboard/contract/ai-log.ts";

/** 통계 한 행. day 는 봇 시간대의 YYYY-MM-DD, costUsd 가 null 이면 가격 모름 */
type UsageRow = { day: string; source: AiLogSource; provider: string; model: string; name: string; guildId: string | null; ok: boolean; tookMs: number; input: number; output: number; cached: number; reasoning: number; costUsd: number | null };

/** 그 시각의 날짜(봇 시간대) */
function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 날짜 문자열에 n 일을 더한다(시간대와 무관하게 달력으로) */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + n));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
}

/** 기간의 첫날. 전체(0)면 가장 이른 기록의 날짜(없으면 오늘) */
function firstDay(period: AiUsagePeriod, today: string, earliest: string | null): string {
  return period ? addDays(today, -(period - 1)) : (earliest ?? today);
}

/** 그룹 하나의 합. 응답 시간은 성공한 것만(p95 는 올림 자리) */
function bucketOf(rows: readonly UsageRow[]): AiUsageBucket {
  const took = rows
    .filter((one) => one.ok)
    .map((one) => one.tookMs)
    .sort((a, b) => a - b);
  const add = (pick: (one: UsageRow) => number) => rows.reduce((n, one) => n + pick(one), 0);
  return {
    requests: rows.length,
    failed: rows.filter((one) => !one.ok).length,
    input: add((one) => one.input),
    output: add((one) => one.output),
    cached: add((one) => one.cached),
    reasoning: add((one) => one.reasoning),
    costUsd: add((one) => one.costUsd ?? 0),
    unpriced: rows.filter((one) => one.costUsd === null).length,
    avgMs: took.length ? Math.round(took.reduce((n, ms) => n + ms, 0) / took.length) : null,
    p95Ms: took.length ? took[Math.ceil(took.length * 0.95) - 1] : null,
  };
}

/** 키로 묶어 요청이 많은 순서로. 키가 undefined 인 행은 뺀다 */
function groupBy<K>(rows: readonly UsageRow[], keyOf: (one: UsageRow) => K | undefined): Array<[K, UsageRow[]]> {
  const out = new Map<K, UsageRow[]>();
  for (const one of rows) {
    const key = keyOf(one);
    if (key === undefined) continue;
    const list = out.get(key);
    if (list) list.push(one);
    else out.set(key, [one]);
  }
  return [...out.entries()].sort((a, b) => b[1].length - a[1].length);
}

/**
 * 보고서. rows 는 기간 안의 기록(필터링을 마친 것), from 은 기간의 첫날, today 는 오늘.
 * 날마다는 빈 날도 0 으로 채운다. 모델별은 모델이 없는 요청(모델 목록)을 뺀다. guildName 은 서버 이름(모르면 id 를 돌려준다)
 */
function usageReport(rows: readonly UsageRow[], { period, from, today, guildName }: { period: AiUsagePeriod; from: string; today: string; guildName: (id: string) => string }): AiUsageReport {
  const byDay = new Map(groupBy(rows, (one) => one.day));
  const daily: AiUsageReport["daily"] = [];
  for (let day = from; day <= today; day = addDays(day, 1)) daily.push({ day, ...bucketOf(byDay.get(day) ?? []) });
  return {
    period,
    total: bucketOf(rows),
    daily,
    byModel: groupBy(rows, (one) => (one.model ? `${one.provider}/${one.model}` : undefined)).map(([, group]) => ({ model: group[0].model, provider: group[0].provider, name: group[0].name, ...bucketOf(group) })),
    bySource: groupBy(rows, (one) => one.source).map(([source, group]) => ({ source, ...bucketOf(group) })),
    byGuild: groupBy(rows, (one) => one.guildId ?? undefined).map(([guildId, group]) => ({ guildId, guildName: guildName(guildId), ...bucketOf(group) })),
  };
}

export { dayKey, addDays, firstDay, bucketOf, usageReport };
export type { UsageRow };
