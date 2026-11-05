// 디스코드 앱 이모지 동기화. 아이콘 표(ui/icons)를 렌더링한 이미지(ui/icon-images)가 봇의 디스코드 앱에 올라가 있게 하고, 이름 → id 를 표에 싣는다.
// 앱의 이모지 전부는 store/app-emoji-book 에 싣는다(설정에 적힌 앱 이모지 토큰을 찾을 때). 아이콘의 옛 이름과 유니코드도 함께 넣는다.
// 건드리는 것은 봇이 올린 것 중 관리하는 이름(지금 아이콘 이름, 옛 이름, 그 임시 이름)뿐이다. 운영자가 개발자 포털이나 대시보드에서 올린 이모지는
// 아이콘과 이름이 같아도 지우지 않고 그 아이콘은 유니코드로 둔다(대시보드에서 올린 것도 작성자가 봇이라 store/app-emoji-records 의 id 로 가린다).
// 같은지는 CDN 의 이미지와 비교한다(PNG 는 올린 바이트 그대로 돌아온다. 움직이는 GIF 는 디스코드가 다시 인코딩해 프레임 픽셀을 허용치 안에서 비교한다).
// 이름은 앱 안에서 하나뿐이라 이미지가 바뀐 것은 임시 이름으로 올려 쓰는 쪽을 바꾸고 옛 것을 지운 뒤 이름을 되돌린다.
// 기동 시에는 목록 하나로 이름 → id 를 먼저 싣고(패널 복원 전) 비교, 업로드는 백그라운드에서 한다. 운영자 색이 바뀌면 다시 동기화한다.

import type { Client } from "discord.js";
import sharp from "sharp";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { httpFor } from "../infra/http.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { codedError, messageOf } from "../rules/error-kind.ts";
import { RETIRED_EMOJI_NAMES, iconEntries, isManagedEmojiName, useUploaded } from "../ui/icons.ts";
import { appEmojis, useAppEmojis, useIconFallbacks } from "../store/app-emoji-book.ts";
import { imageOf } from "../ui/icon-images.ts";
import { APP_EMOJI_LIMIT as EMOJI_LIMIT } from "../dashboard/contract/app-emojis.ts";
const log = logger.child({ category: "core", sub: "emoji" });

// 찾지 못한 아이콘 토큰(동기화 전, 옛 이름)을 대신할 유니코드. store 층은 ui 를 부르지 못해 여기서 넣는다
const iconUnicode = new Map(iconEntries().map((entry) => [entry.name, entry.spec.unicode]));
useIconFallbacks({ retired: RETIRED_EMOJI_NAMES, iconUnicode: (name) => iconUnicode.get(name) });

/** 앱에 있는 이모지 하나. mine: 봇이 올렸다 */
type Remote = { id: string; name: string; animated: boolean; mine: boolean };
/** 디스코드 쪽. 테스트가 가짜를 넘긴다 */
type Api = {
  list(): Promise<Remote[]>;
  /** CDN 의 이미지(PNG 는 .png, 움직이는 것은 .gif). 못 받으면 null */
  download(remote: Remote): Promise<Buffer | null>;
  create(name: string, data: Buffer): Promise<Remote>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
};
type Image = { data: Buffer; animated: boolean };

const CDN_TIMEOUT_MS = 15_000;
/** 렌더링, CDN 비교를 동시에 하는 수 */
const COMPARE_AT_ONCE = 8;
/** 움직이는 GIF 를 비교할 때 픽셀 하나의 허용 차(0 ~ 255). 디스코드가 다시 인코딩하면 5 안팎, 색이 바뀌면 훨씬 크다 */
const GIF_TOLERANCE = 12;
/** 운영자 색이 바뀌면 다시 올라가는 아이콘 수: 동기화가 새것을 먼저 올리고 옛것을 끝에 지워, 그만큼 자리가 있어야 한다 */
const recolored = () => iconEntries().filter((entry) => entry.tint === "brand" && entry.spec.shape !== "logo").length;
/** 운영자 패널에서 더 올릴 수 있는 수(지금 앱 이모지 수에서) */
const roomOf = (count: number) => Math.max(0, EMOJI_LIMIT - count - recolored());
/** 운영자가 색을 바꾸는 동안 잦은 저장을 모으는 시간 */
const SETTLE_MS = 3000;

const cdn = httpFor("discord");

/** discord.js 로 만든 실제 Api */
function apiOf(client: Client<true>): Api {
  const emojis = () => client.application.emojis;
  const remoteOf = (emoji: { id: string; name: string | null; animated: boolean | null; author: { id: string } | null }): Remote => ({
    id: emoji.id,
    name: emoji.name ?? "",
    animated: Boolean(emoji.animated),
    mine: emoji.author?.id === client.user.id,
  });
  return {
    list: async () => [...(await emojis().fetch()).values()].map(remoteOf),
    download: async (remote) => {
      const url = `https://cdn.discordapp.com/emojis/${remote.id}.${remote.animated ? "gif" : "png"}`;
      const res = await cdn.fetch(url, { signal: AbortSignal.timeout(CDN_TIMEOUT_MS) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
    create: async (name, data) => remoteOf(await emojis().create({ attachment: data, name })),
    rename: async (id, name) => void (await emojis().edit(id, { name })),
    remove: async (id) => void (await emojis().delete(id)),
  };
}

/** 렌더링한 이미지와 CDN 의 이미지가 같은가 */
async function sameImage(local: Image, remote: Buffer) {
  if (!local.animated) return local.data.equals(remote);
  const decode = async (data: Buffer) => {
    const image = sharp(data, { animated: true });
    const { pages, delay } = await image.metadata();
    return { pages, delay: String(delay), raw: await image.ensureAlpha().raw().toBuffer() };
  };
  const [a, b] = await Promise.all([decode(local.data), decode(remote)]);
  if (a.pages !== b.pages || a.delay !== b.delay || a.raw.length !== b.raw.length) return false;
  for (let i = 0; i < a.raw.length; i++) if (Math.abs(a.raw[i] - b.raw[i]) > GIF_TOLERANCE) return false;
  return true;
}

/** 결과 순서를 지키며 limit 개까지 동시에 */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let at = 0;
  const lane = async () => {
    while (at < items.length) {
      const i = at++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** 올라가 있는 것이 그 이미지인가. CDN 에서 못 받으면 아니라고 본다 */
async function uploadedAs(api: Api, remote: Remote, image: Image) {
  const there = await api.download(remote).catch((error: unknown) => (log.debug(`앱 이모지 ${remote.name} 이미지 다운로드 실패: ${messageOf(error)}`), null));
  return there !== null && (await sameImage(image, there));
}

/** 이름이 겹치지 않는 임시 이름(32자 안) */
function tempName(name: string, taken: ReadonlySet<string>) {
  for (let n = 1; ; n++) {
    const suffix = `_${n}`;
    const candidate = name.slice(0, 32 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** 운영자가 대시보드에서 올린 id(작성자가 봇이어도 운영자가 올린 것으로 본다). 테스트는 넘기지 않는다 */
type Protected = () => ReadonlySet<string>;
const NONE: Protected = () => new Set();

/** onChanged: 쓰는 쪽의 id 가 바뀐 뒤(옛 것을 지우기 전). stale: 참이면 멈춘다. protectedIds: 대시보드에서 올린 id. forget: 앱에 없는 id 를 그 기록에서 지운다 */
type SyncOptions = { onChanged: () => Promise<unknown>; stale?: () => boolean; protectedIds?: Protected; forget?: (existing: ReadonlySet<string>) => void };

/** 동기화가 건드려도 되는 것: 봇이 올렸고, 대시보드에서 올린 것이 아니다 */
const ownedBy = (remote: Remote, protectedIds: ReadonlySet<string>) => remote.mine && !protectedIds.has(remote.id);

/** 목록만으로: 앱의 이모지 전부와, 표의 이름 중 봇이 올린 것의 id 를 싣는다(이미지가 맞는지는 sync 가 본다) */
async function loadKnown(api: Api, protectedIds: Protected = NONE) {
  const expected = new Map(iconEntries().map((entry) => [entry.name, entry]));
  const known = new Map<string, { id: string; animated: boolean }>();
  const kept = protectedIds();
  const list = await api.list();
  for (const remote of list) if (ownedBy(remote, kept) && expected.has(remote.name)) known.set(remote.name, { id: remote.id, animated: remote.animated });
  useUploaded(known);
  useAppEmojis(list);
  return known.size;
}

/**
 * 지금 앱의 목록을 동기화가 쓸 형태로 나누고, 표에 없는 관리 이름(옛 아이콘, 실패한 동기화가 남긴 임시 이름)을 먼저 지운다(앱 이모지 수 한도에 자리를 비워 두려고).
 * mine: 이번에 쓸 수 있는 봇의 관리 이름, takenByOthers: 아이콘이 쓰지 못하는 이름, taken: 앱에 있는 이름 전부(임시 이름을 지을 때)
 */
async function partition(api: Api, remote: Remote[], kept: ReadonlySet<string>) {
  const owned = remote.filter((one) => ownedBy(one, kept) && isManagedEmojiName(one.name));
  const mine = new Map(owned.map((one) => [one.name, one]));
  // 관리하지 않는 이름은 봇이 올렸어도(대시보드에서 올린 것, 이 버전이 모르는 것) 남의 것으로 본다
  const ownedIds = new Set(owned.map((one) => one.id));
  const takenByOthers = new Set(remote.filter((one) => !ownedIds.has(one.id)).map((one) => one.name));
  const taken = new Set(remote.map((one) => one.name));
  const expected = new Set(iconEntries().map((entry) => entry.name));
  for (const one of owned.filter((o) => !expected.has(o.name))) {
    await api.remove(one.id);
    mine.delete(one.name);
    taken.delete(one.name);
  }
  return { mine, takenByOthers, taken, cleared: owned.length - mine.size };
}

/** 동기화를 마친 뒤: 바뀐 것이 있으면 목록을 다시 불러 앱의 이모지 전부를 싣고, 앱에 없는 id 를 기록에서 지우게 넘기고, 남긴다 */
async function publish(api: Api, remote: Remote[], { added, removed, total, skipped, forget }: { added: number; removed: number; total: number; skipped: string[]; forget: SyncOptions["forget"] }) {
  const now = added || removed ? await api.list() : remote;
  useAppEmojis(now);
  forget?.(new Set(now.map((one) => one.id)));
  if (skipped.length) log.warn(`운영자가 올린 동명 앱 이모지가 있어 해당 아이콘은 유니코드로 둡니다: ${skipped.join(", ")}. 운영자 패널이나 개발자 포털에서 이모지 이름을 바꾸거나 삭제하세요`);
  if (added || removed) log.info(`앱 이모지 동기화: ${total}개 중 ${added}개 추가, ${removed}개 삭제`);
  else log.debug(`앱 이모지 동기화: ${total}개 변경 없음`);
}

/**
 * 동기화. onChanged: 쓰는 쪽의 id 가 바뀐 뒤(옛 것을 지우기 전) 계속 갱신하는 메시지를 다시 그린다.
 * stale: 참이면 업로드를 멈추고 아무것도 바꾸지 않은 채 끝낸다(그새 운영자 색이 또 바뀜). 그때까지 올린 것은 다음 동기화가 지운다
 */
async function sync(api: Api, { onChanged, stale = () => false, protectedIds = NONE, forget }: SyncOptions) {
  const remote = await api.list();
  const { mine, takenByOthers, taken, cleared } = await partition(api, remote, protectedIds());
  // 봇이 올린 관리 이름 중 이번에 쓰지 않는 것(옛 이미지)은 끝에 지운다
  const unused = new Set([...mine.values()].map((one) => one.id));
  const next = new Map<string, { id: string; animated: boolean }>();
  const renames: Array<{ id: string; name: string }> = [];
  const skipped: string[] = [];
  let added = 0;

  const entries = iconEntries().filter((entry) => {
    if (takenByOthers.has(entry.name)) skipped.push(entry.name);
    return !takenByOthers.has(entry.name);
  });
  // 렌더링, CDN 비교는 서로 기대지 않아 동시에(동기화 시간의 대부분이다), 업로드는 하나씩
  const checked = await mapLimit(entries, COMPARE_AT_ONCE, async (entry) => {
    const image = await imageOf(entry.spec, entry.tint);
    const existing = mine.get(entry.name);
    return { entry, image, existing, same: existing ? await uploadedAs(api, existing, image) : false };
  });

  for (const { entry, image, existing, same } of checked) {
    if (existing && same) {
      next.set(entry.name, { id: existing.id, animated: existing.animated });
      unused.delete(existing.id);
      continue;
    }
    if (stale()) {
      log.debug(`앱 이모지 동기화 중단(재동기화): ${added}개 등록 후`);
      return;
    }
    const name = existing ? tempName(entry.name, taken) : entry.name;
    taken.add(name);
    const created = await api.create(name, image.data);
    next.set(entry.name, { id: created.id, animated: image.animated });
    if (name !== entry.name) renames.push({ id: created.id, name: entry.name });
    added += 1;
  }

  useUploaded(next);
  if (added) await onChanged();
  for (const id of unused) await api.remove(id);
  for (const { id, name } of renames) await api.rename(id, name);
  await publish(api, remote, { added, removed: unused.size + cleared, total: next.size, skipped, forget });
}

/** 기동과 운영자 색 변경을 잇는다. 동기화는 한 번에 하나, 도는 중에 다시 요청되면 끝난 뒤 한 번 더 */
class AppEmojis {
  api: Api;
  onChanged: () => Promise<unknown>;
  running: Promise<void> | null = null;
  again = false;
  color: string;
  timer: NodeJS.Timeout | null = null;
  off: (() => void) | null = null;

  protectedIds: Protected;
  forget: SyncOptions["forget"];
  remember: ((id: string) => void) | undefined;
  /** 동기화와 운영자 패널의 조작(올리기, 이름 바꾸기, 지우기)을 한 줄로. 동기화가 처음에 본 목록이 그 사이 바뀌지 않게 */
  tail: Promise<unknown> = Promise.resolve();

  constructor(api: Api, { onChanged, protectedIds = NONE, forget, remember }: Pick<SyncOptions, "onChanged" | "protectedIds" | "forget"> & { remember?: (id: string) => void }) {
    this.api = api;
    this.onChanged = onChanged;
    this.protectedIds = protectedIds;
    this.forget = forget;
    this.remember = remember;
    this.color = config.bot.embedColor;
  }

  /** 앞의 일이 끝난 뒤 task 를 돌린다(실패해도 줄은 이어진다) */
  serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** 운영자 패널에서 더 올릴 수 있는 수 */
  room() {
    return roomOf(appEmojis().length);
  }

  /** 운영자 패널의 조작 뒤: 앱의 목록을 다시 싣고 기록을 맞춘다 */
  async reload() {
    const list = await this.api.list();
    useAppEmojis(list);
    this.forget?.(new Set(list.map((one) => one.id)));
    return list;
  }

  /** 운영자 패널에서 올리기. 이름은 부른 쪽이 규칙을 봤다. 앱에 같은 이름이 있거나 자리가 없으면 던진다 */
  add(name: string, image: Buffer): Promise<Remote> {
    return this.serial(async () => {
      const list = await this.api.list();
      if (list.some((one) => one.name === name)) throw codedError("EMOJI_NAME_TAKEN", name);
      if (roomOf(list.length) < 1) throw codedError("EMOJI_FULL", String(list.length));
      const created = await this.api.create(name, image);
      this.remember?.(created.id);
      await this.reload();
      return created;
    });
  }

  /** 운영자 패널에서 이름 바꾸기. 아이콘(관리하는 이름)은 바꾸지 않는다 */
  rename(id: string, name: string): Promise<void> {
    return this.serial(async () => {
      const list = await this.api.list();
      const target = list.find((one) => one.id === id);
      if (!target) throw codedError("EMOJI_NOT_FOUND", id);
      if (isManagedEmojiName(target.name)) throw codedError("EMOJI_IS_ICON", target.name);
      if (list.some((one) => one.name === name && one.id !== id)) throw codedError("EMOJI_NAME_TAKEN", name);
      await this.api.rename(id, name);
      await this.reload();
    });
  }

  /** 운영자 패널에서 지우기. 아이콘은 지우지 않는다(동기화가 다시 올린다) */
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const target = (await this.api.list()).find((one) => one.id === id);
      if (!target) throw codedError("EMOJI_NOT_FOUND", id);
      if (isManagedEmojiName(target.name)) throw codedError("EMOJI_IS_ICON", target.name);
      await this.api.remove(id);
      await this.reload();
    });
  }

  /** 패널 복원 전에 부른다. 실패해도 유니코드로 돈다 */
  async loadKnown() {
    try {
      const count = await loadKnown(this.api, this.protectedIds);
      log.debug(`앱 이모지 ${count}개를 불러옴`);
    } catch (error) {
      log.warn(`앱 이모지 목록을 불러오지 못해 아이콘을 유니코드로 둡니다: ${messageOf(error)}`);
    }
  }

  /** 백그라운드에서 동기화하고, 운영자 색이 바뀌면 다시 동기화한다 */
  start() {
    this.request();
    this.off = onTunablesChanged(() => {
      if (config.bot.embedColor === this.color) return;
      this.color = config.bot.embedColor;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.request(), SETTLE_MS);
      this.timer.unref?.();
    });
  }

  request() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        // 실패하면 그때까지 실은 것(목록에서 불러온 id, 유니코드)으로 돈다. 아이콘이 옛 이미지, 유니코드로 남으므로 알린다
        await this.serial(() => sync(this.api, { onChanged: this.onChanged, stale: () => this.again, protectedIds: this.protectedIds, forget: this.forget })).catch((error: unknown) => log.warn(`앱 이모지 동기화 실패(기존 상태로 계속 실행): ${messageOf(error)}`));
      } while (this.again);
    })().finally(() => (this.running = null));
  }

  stop() {
    this.off?.();
    if (this.timer) clearTimeout(this.timer);
  }
}

export { AppEmojis, apiOf, loadKnown, sync, sameImage, tempName, roomOf, EMOJI_LIMIT };
export type { Api, Remote };
