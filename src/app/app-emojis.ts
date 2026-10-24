// 디스코드 앱 이모지 맞추기. 아이콘 표(ui/icons)를 구운 그림(ui/icon-images)이 봇의 디스코드 앱에 올라가 있게 하고, 이름 → id 를 표에 싣는다.
// 봇이 올린 것(작성자가 봇)만 건드린다: 운영자가 같은 이름으로 올린 이모지는 지우지 않고 그 아이콘은 유니코드로 둔다.
// 같은지는 CDN 의 그림과 견준다(PNG 는 올린 바이트 그대로 돌아온다. 움직이는 GIF 는 디스코드가 다시 인코딩해 프레임 픽셀을 허용치 안에서 견준다).
// 이름은 앱 안에서 하나뿐이라 그림이 바뀐 것은 임시 이름으로 올려 쓰는 쪽을 바꾸고 옛 것을 지운 뒤 이름을 되돌린다.
// 기동 때는 목록 하나로 이름 → id 를 먼저 싣고(패널 복원 전) 견주기 · 올리기는 뒤에서 한다. 운영자 색이 바뀌면 다시 맞춘다.

import type { Client } from "discord.js";
import sharp from "sharp";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { httpFor } from "../infra/http.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { messageOf } from "../rules/error-kind.ts";
import { iconEntries, useUploaded } from "../ui/icons.ts";
import { imageOf } from "../ui/icon-images.ts";
const log = logger.child({ category: "core", sub: "emoji" });

/** 앱에 있는 이모지 하나. mine: 봇이 올렸다 */
type Remote = { id: string; name: string; animated: boolean; mine: boolean };
/** 디스코드 쪽. 시험이 가짜를 넘긴다 */
type Api = {
  list(): Promise<Remote[]>;
  /** CDN 의 그림(PNG 는 .png, 움직이는 것은 .gif). 못 받으면 null */
  download(remote: Remote): Promise<Buffer | null>;
  create(name: string, data: Buffer): Promise<Remote>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
};
type Image = { data: Buffer; animated: boolean };

const CDN_TIMEOUT_MS = 15_000;
/** 굽기 · CDN 견주기를 함께 하는 수 */
const COMPARE_AT_ONCE = 8;
/** 움직이는 GIF 를 견줄 때 픽셀 하나의 허용 차(0 ~ 255). 디스코드가 다시 인코딩하면 5 안팎, 색이 바뀌면 훨씬 크다 */
const GIF_TOLERANCE = 12;
/** 운영자 색을 고르는 동안 잦은 저장을 모으는 시간 */
const SETTLE_MS = 3000;

const cdn = httpFor("discord");

/** discord.js 로 */
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

/** 구운 그림과 CDN 의 그림이 같은가 */
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

/** 차례를 지키며 limit 개까지 함께 */
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

/** 올라가 있는 것이 그 그림인가. CDN 에서 못 받으면 아니라고 본다 */
async function uploadedAs(api: Api, remote: Remote, image: Image) {
  const there = await api.download(remote).catch((error: unknown) => (log.debug(`앱 이모지 ${remote.name} 그림 받기 실패: ${messageOf(error)}`), null));
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

/** 목록만으로: 표의 이름 중 봇이 올린 것의 id 를 싣는다(그림이 맞는지는 sync 가 본다) */
async function loadKnown(api: Api) {
  const expected = new Map(iconEntries().map((entry) => [entry.name, entry]));
  const known = new Map<string, { id: string; animated: boolean }>();
  for (const remote of await api.list()) if (remote.mine && expected.has(remote.name)) known.set(remote.name, { id: remote.id, animated: remote.animated });
  useUploaded(known);
  return known.size;
}

/**
 * 맞추기. onChanged: 쓰는 쪽의 id 가 바뀐 뒤(옛 것을 지우기 전) 계속 고치는 메시지를 다시 그린다.
 * stale: 참이면 올리기를 멈추고 아무것도 바꾸지 않은 채 끝낸다(그새 운영자 색이 또 바뀜). 그때까지 올린 것은 다음 맞추기가 지운다
 */
async function sync(api: Api, { onChanged, stale = () => false }: { onChanged: () => Promise<unknown>; stale?: () => boolean }) {
  const remote = await api.list();
  const mine = new Map(remote.filter((one) => one.mine).map((one) => [one.name, one]));
  const takenByOthers = new Set(remote.filter((one) => !one.mine).map((one) => one.name));
  const taken = new Set(remote.map((one) => one.name));
  // 봇이 올린 것 중 이번에 쓰지 않는 것(옛 그림 · 표에서 뺀 것 · 이름 바꾸다 남은 임시 이름)은 끝에 지운다
  const unused = new Set([...mine.values()].map((one) => one.id));
  const next = new Map<string, { id: string; animated: boolean }>();
  const renames: Array<{ id: string; name: string }> = [];
  const skipped: string[] = [];
  let added = 0;

  const entries = iconEntries().filter((entry) => {
    if (takenByOthers.has(entry.name)) skipped.push(entry.name);
    return !takenByOthers.has(entry.name);
  });
  // 굽기 · CDN 견주기는 서로 기대지 않아 여럿 함께(맞추기 시간의 대부분이다), 올리기는 하나씩
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
      log.debug(`앱 이모지 맞춤을 멈춤(다시 맞춤): ${added}개 올린 뒤`);
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

  if (skipped.length) log.warn(`봇이 올리지 않은 앱 이모지가 이름을 쓰고 있어 그 아이콘은 유니코드로 둡니다: ${skipped.join(", ")}. 개발자 포털에서 그 이모지의 이름을 바꾸거나 지우세요`);
  if (added || unused.size) log.info(`앱 이모지 맞춤: ${next.size}개 중 ${added}개 새로 올림 · ${unused.size}개 지움`);
  else log.debug(`앱 이모지 맞춤: ${next.size}개 그대로`);
}

/** 기동과 운영자 색 바뀜을 잇는다. 맞추기는 한 번에 하나, 도는 중에 다시 하라면 끝난 뒤 한 번 더 */
class AppEmojis {
  api: Api;
  onChanged: () => Promise<unknown>;
  running: Promise<void> | null = null;
  again = false;
  color: string;
  timer: NodeJS.Timeout | null = null;
  off: (() => void) | null = null;

  constructor(api: Api, { onChanged }: { onChanged: () => Promise<unknown> }) {
    this.api = api;
    this.onChanged = onChanged;
    this.color = config.bot.embedColor;
  }

  /** 패널 복원 전에 부른다. 실패해도 유니코드로 돈다 */
  async loadKnown() {
    try {
      const count = await loadKnown(this.api);
      log.debug(`앱 이모지 ${count}개를 불러옴`);
    } catch (error) {
      log.warn(`앱 이모지 목록을 받지 못해 아이콘을 유니코드로 둡니다: ${messageOf(error)}`);
    }
  }

  /** 뒤에서 맞추고, 운영자 색이 바뀌면 다시 맞춘다 */
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
        // 실패하면 그때까지 실은 것(목록에서 불러온 id · 유니코드)으로 돈다. 아이콘이 옛 그림 · 유니코드로 남으므로 알린다
        await sync(this.api, { onChanged: this.onChanged, stale: () => this.again }).catch((error: unknown) => log.warn(`앱 이모지를 맞추지 못했습니다(그대로 돕니다): ${messageOf(error)}`));
      } while (this.again);
    })().finally(() => (this.running = null));
  }

  stop() {
    this.off?.();
    if (this.timer) clearTimeout(this.timer);
  }
}

export { AppEmojis, apiOf, loadKnown, sync, sameImage, tempName };
export type { Api, Remote };
