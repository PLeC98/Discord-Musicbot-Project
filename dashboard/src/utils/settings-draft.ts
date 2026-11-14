// 서버 설정 화면의 저장 순서와 값 합치기. 화면(ServerSettingsView)은 요청 함수와, 고치는 값을 키마다 읽고 쓰는 함수만 넘긴다.
// 언제 무엇을 보낼지, 응답과 다시 읽은 값을 어떻게 반영할지는 여기서 정한다.
// 기준값(base)은 서버가 준 값, 고치는 값(draft)은 화면의 입력이다. 두 값이 다른 키가 고친 키다.

import { keysOf, sameValue, valueAt, withValue, type SettingsKey, type SettingsValues } from "../../../src/rules/guild-settings-values.ts";
import type { GuildSettings, SettingsConflict, SettingsSaved } from "../../../src/dashboard/contract/guilds.ts";
import type { SettingsPatch } from "../../../src/dashboard/request-schemas.ts";
import { problemCodeOf, replyOf, statusOf } from "./request.ts";

/** 받은 설정에서 보이는 카드의 값 */
function valuesOf(data: GuildSettings): SettingsValues {
  return {
    ...(data.channel && { botChannelId: data.channel.botChannelId }),
    ...(data.dj && { djRoleIds: [...data.dj.djRoleIds] }),
    ...(data.sponsorblock && { sponsorblock: { enabled: data.sponsorblock.enabled, categories: data.sponsorblock.categories && [...data.sponsorblock.categories] } }),
    ...(data.playlistAdd && { playlistAddMax: data.playlistAdd.value }),
    ...(data.agePlace !== undefined && { agePlace: data.agePlace }),
  };
}

/** 고친 키(기준값과 다른 키). 떠날 때 물을지 정하는 데 쓴다 */
const unsavedKeys = (base: SettingsValues, draft: SettingsValues): SettingsKey[] => keysOf(base).filter((key) => !sameValue(key, valueAt(base, key), valueAt(draft, key)));

/** 보낼 키. 고친 키 가운데 hold(숫자 입력 중, 범위 밖)와 막힌 키를 뺀 것 */
const sendableKeys = (base: SettingsValues, draft: SettingsValues, hold: readonly SettingsKey[]): SettingsKey[] => unsavedKeys(base, draft).filter((key) => !hold.includes(key));

/** 보낼 본문. 키마다 기준값(from)과 고치는 값(to). 보낼 키가 없으면 null */
function patchOf(base: SettingsValues, draft: SettingsValues, keys: readonly SettingsKey[]): SettingsPatch | null {
  if (!keys.length) return null;
  const change = (key: SettingsKey) => ({ from: valueAt(base, key), to: valueAt(draft, key) });
  const body: Record<string, unknown> = {};
  const sponsorblock: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "sponsorblock.enabled") sponsorblock.enabled = change(key);
    else if (key === "sponsorblock.categories") sponsorblock.categories = change(key);
    else body[key] = change(key);
  }
  if (Object.keys(sponsorblock).length) body.sponsorblock = sponsorblock;
  return body as SettingsPatch;
}

/** 합친 결과. touched: 고치는 값이 바뀐 키(화면은 그 키의 입력만 고쳐 쓴다) */
type Merged = { base: SettingsValues; draft: SettingsValues; touched: SettingsKey[] };

/** 저장 응답을 반영한다. 보낸 키만 기준값을 응답 값으로 바꾸고, 고치는 값이 보낸 그대로면 그것도 응답 값으로 바꾼다(서버가 거른 역할이 화면에서도 빠지게). 그사이 또 고쳤으면 둔다 */
function acceptSaved(base: SettingsValues, draft: SettingsValues, sent: SettingsValues, values: SettingsValues): Merged {
  const touched: SettingsKey[] = [];
  for (const key of keysOf(sent)) {
    base = withValue(base, key, valueAt(values, key));
    if (sameValue(key, valueAt(draft, key), valueAt(sent, key)) && !sameValue(key, valueAt(draft, key), valueAt(values, key))) {
      draft = withValue(draft, key, valueAt(values, key));
      touched.push(key);
    }
  }
  return { base, draft, touched };
}

/** 충돌 응답을 반영한다. 충돌한 키만 기준값과 고치는 값을 지금 값으로 바꾼다(고치던 값은 버린다) */
function acceptConflict(base: SettingsValues, draft: SettingsValues, { conflicts, current }: SettingsConflict): Merged {
  for (const key of conflicts) {
    base = withValue(base, key, valueAt(current, key));
    draft = withValue(draft, key, valueAt(current, key));
  }
  return { base, draft, touched: [...conflicts] };
}

/**
 * 다시 읽은 값을 반영한다. 고치는 중이 아닌 키만 기준값과 고치는 값을 함께 바꾼다(기준값만 바꾸면 고친 키로 잡혀 옛 값을 다시 저장한다).
 * 새로 보인 카드의 키는 둘을 함께 채우고, 사라진 카드의 키는 둘에서 뺀다(이제 고칠 수 없다)
 */
function mergeRefresh(base: SettingsValues, draft: SettingsValues, fresh: SettingsValues): Merged {
  const touched: SettingsKey[] = [];
  const editing = new Set(unsavedKeys(base, draft));
  for (const key of keysOf(base)) {
    if (valueAt(fresh, key) !== undefined) continue;
    base = withValue(base, key, undefined);
    draft = withValue(draft, key, undefined);
  }
  for (const key of keysOf(fresh)) {
    const value = valueAt(fresh, key);
    if (editing.has(key) || sameValue(key, valueAt(base, key), value)) {
      base = withValue(base, key, value);
      continue;
    }
    base = withValue(base, key, value);
    draft = withValue(draft, key, value);
    touched.push(key);
  }
  return { base, draft, touched };
}

/**
 * 운영자의 기본 구간을 따르던 서버에서 고친 구간이 기본 구간과 같아지면(눌렀다 되돌림) 다시 따르는 것(null)으로 본다.
 * 아무것도 바꾸지 않은 것이라 서버 값으로 굳히지 않는다
 */
function inheritCategories(base: SettingsValues, draft: SettingsValues, defaults: readonly string[]): SettingsValues {
  const categories = valueAt(draft, "sponsorblock.categories");
  if (valueAt(base, "sponsorblock.categories") !== null || !Array.isArray(categories)) return draft;
  return sameValue("sponsorblock.categories", categories, defaults) ? withValue(draft, "sponsorblock.categories", null) : draft;
}

// 필드 오류의 문제 코드와 위치로 찾는 키
const FIELD_CODE_KEYS: Readonly<Record<string, SettingsKey[]>> = { "bad-bot-channel": ["botChannelId"], "too-many-dj-roles": ["djRoleIds"] };
const POINTER_KEYS: ReadonlyArray<[RegExp, SettingsKey[]]> = [
  [/^\/botChannelId(\/|$)/, ["botChannelId"]],
  [/^\/djRoleIds(\/|$)/, ["djRoleIds"]],
  [/^\/sponsorblock\/enabled(\/|$)/, ["sponsorblock.enabled"]],
  [/^\/sponsorblock\/categories(\/|$)/, ["sponsorblock.categories"]],
  [/^\/sponsorblock$/, ["sponsorblock.enabled", "sponsorblock.categories"]],
  [/^\/playlistAddMax(\/|$)/, ["playlistAddMax"]],
  [/^\/agePlace(\/|$)/, ["agePlace"]],
];

/** 필드 오류(400)가 가리키는 키. 찾지 못하면 빈 배열 */
function fieldKeysOf(reply: unknown): SettingsKey[] {
  const code = problemCodeOf(reply);
  if (code && FIELD_CODE_KEYS[code]) return FIELD_CODE_KEYS[code];
  if (code !== "bad-settings") return [];
  const errors = (reply as { errors?: Array<{ pointer?: unknown }> }).errors ?? [];
  const keys = new Set<SettingsKey>();
  for (const { pointer } of errors) {
    const hit = typeof pointer === "string" ? POINTER_KEYS.find(([pattern]) => pattern.test(pointer)) : undefined;
    if (!hit) return [];
    for (const key of hit[1]) keys.add(key);
  }
  return [...keys];
}

/** 저장 실패의 종류. 상태 하나에 코드가 여럿이라(409 에 account-changed 도 있다) 문제 코드로 구분한다 */
type Failure = { kind: "conflict"; conflict: SettingsConflict } | { kind: "field"; keys: SettingsKey[] } | { kind: "permission" } | { kind: "gone" } | { kind: "other" };

/** 서버나 멤버가 사라졌다(다시 해도 같다) */
const GONE_CODES = ["guild-not-found", "no-guild-access"];
// 그사이 권한이 바뀌었다(설정을 다시 읽어 바뀐 카드 목록에 맞춘다)
const PERMISSION_CODES = ["must-server-manager", "must-dj"];

function failureOf(error: unknown): Failure {
  const reply = replyOf(error);
  const code = problemCodeOf(reply);
  if (code === "settings-changed" && reply && typeof reply === "object" && Array.isArray((reply as SettingsConflict).conflicts)) {
    return { kind: "conflict", conflict: reply as SettingsConflict };
  }
  if (code && GONE_CODES.includes(code)) return { kind: "gone" };
  if (code && PERMISSION_CODES.includes(code)) return { kind: "permission" };
  if (statusOf(error) === 400) {
    const keys = fieldKeysOf(reply);
    if (keys.length) return { kind: "field", keys };
  }
  return { kind: "other" };
}

/** 다시 읽기 실패가 이 화면을 더 볼 수 없다는 뜻이다(볼 카드가 없음, 서버가 사라짐) */
const lostView = (error: unknown) => statusOf(error) === 403 || GONE_CODES.includes(problemCodeOf(replyOf(error)) ?? "");

/** 저장 컨트롤러가 화면에서 넘겨받는 함수 */
type SaverIO = {
  /** PATCH 를 보내고 응답(values)을 돌려준다 */
  send(patch: SettingsPatch): Promise<SettingsSaved>;
  /** GET */
  fetch(): Promise<GuildSettings>;
  /** 화면 입력의 지금 값(보이는 카드의 키만) */
  read(): SettingsValues;
  /** 주어진 키의 화면 입력을 넘겨받은 값으로 고쳐 쓴다 */
  write(values: SettingsValues, keys: readonly SettingsKey[]): void;
  /** 지금 보내지 않을 키(숫자 입력 중, 범위 밖) */
  hold(): SettingsKey[];
  /** 다시 읽은 설정 가운데 입력값이 아닌 것(카드 목록, 고를 목록, 상주 모드, 볼륨 정규화)을 화면에 반영한다 */
  settings(data: GuildSettings): void;
  saving(): void;
  saved(): void;
  failed(error: unknown, failure: Failure): void;
  /** 이 화면을 더 볼 수 없을 때 오류 화면으로 바꾼다 */
  lost(error: unknown): void;
};

/**
 * 저장 컨트롤러. 요청(저장, 다시 읽기, 켜고 끄기)은 큐에서 한 번에 하나씩 처리한다(보낸 순서대로 응답을 받는다).
 * 저장은 보낼 키가 있고 그 패치가 마지막으로 실패한 패치와 다를 때만 예약한다(실패한 저장을 되풀이하지 않게 한다. 떠날 때만 한 번 더 보낸다)
 */
function createSettingsSaver(io: SaverIO, { debounceMs = 400 } = {}) {
  let base: SettingsValues = {};
  let defaults: readonly string[] = [];
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshWanted = false;
  let failedPatch: string | null = null;
  let stopped = false;
  // 필드 오류로 막은 키와 그때의 입력. 사람이 그 키를 다시 고치면 풀린다
  const blocked = new Map<SettingsKey, unknown>();

  const draft = () => inheritCategories(base, io.read(), defaults);
  const holds = () => {
    const now = draft();
    for (const [key, value] of blocked) if (!sameValue(key, valueAt(now, key), value)) blocked.delete(key);
    return [...io.hold(), ...blocked.keys()];
  };

  /** 큐 끝에 작업을 넣는다. 큐가 비면 미뤄 둔 다시 읽기를 한다 */
  function enqueue(work: () => Promise<void>): Promise<void> {
    pending++;
    chain = chain
      .then(() => (stopped ? undefined : work()))
      .catch(() => undefined)
      .finally(() => {
        pending--;
        if (pending === 0 && refreshWanted && !stopped) {
          refreshWanted = false;
          void enqueue(refresh);
        }
      });
    return chain;
  }

  function adopt(data: GuildSettings) {
    // 입력은 바뀌기 전의 기본 구간을 기준으로 읽는다. 새 기본 구간을 기준으로 읽으면 화면에 남은 옛 기본 구간이 고친 값으로 잡혀 서버 값으로 굳는다
    const current = draft();
    defaults = data.sponsorblock?.defaultCategories ?? [];
    const merged = mergeRefresh(base, current, valuesOf(data));
    base = merged.base;
    io.settings(data);
    const touched = [...merged.touched];
    // 기본 구간을 따르는 중이면 바뀐 기본 구간으로 다시 보여 준다
    if (valueAt(merged.draft, "sponsorblock.categories") === null && !touched.includes("sponsorblock.categories")) touched.push("sponsorblock.categories");
    if (touched.length) io.write(merged.draft, touched);
  }

  async function refresh() {
    try {
      adopt(await io.fetch());
    } catch (error) {
      if (lostView(error)) stop(error);
      // 그 밖은 다음 신호에 다시 읽는다
    }
  }

  function stop(error: unknown) {
    stopped = true;
    clearTimeout(timer);
    base = {};
    io.lost(error);
  }

  async function save(force: boolean) {
    const now = draft();
    const keys = sendableKeys(base, now, holds());
    const patch = patchOf(base, now, keys);
    if (!patch || (!force && JSON.stringify(patch) === failedPatch)) return;
    const sent = keys.reduce<SettingsValues>((out, key) => withValue(out, key, valueAt(now, key)), {});
    io.saving();
    try {
      const { values } = await io.send(patch);
      failedPatch = null;
      const merged = acceptSaved(base, draft(), sent, values);
      base = merged.base;
      if (merged.touched.length) io.write(merged.draft, merged.touched);
      io.saved();
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === "conflict") {
        const merged = acceptConflict(base, draft(), failure.conflict);
        base = merged.base;
        io.write(merged.draft, merged.touched);
      } else if (failure.kind === "field") {
        const current = draft();
        for (const key of failure.keys) blocked.set(key, valueAt(current, key));
      } else if (failure.kind === "permission") refreshWanted = true;
      else if (failure.kind === "gone") return stop(error);
      else failedPatch = JSON.stringify(patch);
      io.failed(error, failure);
    }
    // 저장 중에 또 고쳤거나 되돌렸으면 바로 다음 저장을 예약한다(충돌이나 필드 오류 뒤에 보낼 키가 남았을 때도 같다)
    if (sendableKeys(base, draft(), holds()).length) edited(0);
  }

  /** 사람이 입력을 바꿨을 때 부른다. 잠시 뒤 저장을 예약한다 */
  function edited(delay = debounceMs) {
    if (stopped) return;
    clearTimeout(timer);
    if (!sendableKeys(base, draft(), holds()).length) return;
    timer = setTimeout(() => void enqueue(() => save(false)), delay);
  }

  return {
    /** 처음 읽은 설정으로 기준값과 입력을 채운다 */
    load(data: GuildSettings) {
      defaults = data.sponsorblock?.defaultCategories ?? [];
      base = valuesOf(data);
      io.settings(data);
      io.write(base, keysOf(base));
    },
    edited,
    /** 다른 곳에서 바뀌었다는 신호. 큐가 비어 있으면 바로, 아니면 큐가 빈 뒤 다시 읽는다 */
    nudged() {
      if (stopped) return;
      if (pending) refreshWanted = true;
      else void enqueue(refresh);
    },
    /** 켜고 끄기처럼 따로 보내는 요청도 같은 큐에 넣는다 */
    run: (work: () => Promise<void>) => enqueue(work),
    /** 떠나기 전에 부른다. 숫자 입력을 끝낸 값까지 한 번 보내고(실패했던 것도) 큐가 빌 때까지 기다린 뒤, 남은 고친 키를 돌려준다 */
    async flush(): Promise<SettingsKey[]> {
      clearTimeout(timer);
      if (!stopped) await enqueue(() => save(true));
      return stopped ? [] : unsavedKeys(base, draft());
    },
    /** 고친 키(떠날 때 물을지, 창 닫기 경고를 띄울지 정하는 데 쓴다) */
    unsaved: () => (stopped ? [] : unsavedKeys(base, draft())),
    /** 저장할 곳이 없어졌다(봇 내보내기). 남은 일을 하지 않는다 */
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export { valuesOf, unsavedKeys, sendableKeys, patchOf, acceptSaved, acceptConflict, mergeRefresh, inheritCategories, fieldKeysOf, failureOf, createSettingsSaver };
export type { Merged, Failure, SaverIO };
