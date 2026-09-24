// 서버당 하나뿐인 현재 재생 패널의 자리. 어느 채널의 어느 메시지인지 DB에 남긴다.
// 메모리 참조(player.nowPlayingMessage)는 재생이 끝나거나 재시작하면 없어지므로, 옛 패널을 치우는 기준은 이 기록이다.

import * as GuildSettingsManager from "../store/guildSettings.ts";
import { codeOf } from "../rules/errorKind.ts";
import type { Guild, GuildBasedChannel, WebhookClient } from "discord.js";
import type { PanelRecord } from "../store/guildSettings.ts";
import type { PanelHook as Hook } from "../player/Player.ts";

const UNKNOWN_MESSAGE = 10008;

/** 웹훅을 다시 찾는 쪽(MusicEmbedManager) */
type Embeds = { getOrCreateWebhook(channel: GuildBasedChannel): Promise<Hook | null> };
/** 기록 저장소. 시험은 가짜를 준다 */
type Store = Pick<typeof GuildSettingsManager, "getPanel" | "setPanel">;
type PanelGuild = Pick<Guild, "id" | "channels">;
type Payload = Parameters<WebhookClient["editMessage"]>[1];

class NowPlayingPanel {
  embeds: Embeds;
  store: Store;
  chains = new Map<string, Promise<unknown>>(); // guildId → Promise 꼬리. 기록을 읽고 바꾸는 사이에 다른 게시가 끼지 않게

  constructor(embeds: Embeds, store: Store = GuildSettingsManager) {
    this.embeds = embeds;
    this.store = store;
  }

  _serial<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.chains.get(guildId) || Promise.resolve())
      .catch(() => {
        /* 앞 일의 실패는 그 호출자가 받는다. 뒤 일을 막지 않는다 */
      })
      .then(fn);
    this.chains.set(guildId, run);
    return run.finally(() => {
      if (this.chains.get(guildId) === run) this.chains.delete(guildId);
    });
  }

  /** 방금 올린 메시지를 이 서버의 패널로 삼는다. 기록돼 있던 옛 패널은 지운다. */
  commit(guild: PanelGuild | null | undefined, channel: GuildBasedChannel | null | undefined, message: { id: string } | null | undefined, webhook: Hook | null = null) {
    if (!guild?.id || !channel?.id || !message?.id) return Promise.resolve();
    return this._serial(guild.id, async () => {
      const old = await this.store.getPanel(guild.id);
      await this.store.setPanel(guild.id, channel.id, message.id);
      if (old && old.messageId !== message.id) await this._delete(guild, old, { channel, webhook });
    });
  }

  /** 기록된 패널을 제자리에서 고친다. 고쳤으면 { channel, webhook, messageId }, 없거나 못 고치면 null. */
  edit(guild: PanelGuild | null | undefined, payload: Payload) {
    if (!guild?.id) return Promise.resolve(null);
    return this._serial(guild.id, async () => {
      const record = await this.store.getPanel(guild.id);
      if (!record) return null;
      const channel = await this._channel(guild, record.channelId);
      const webhook = channel && (await this.embeds.getOrCreateWebhook(channel));
      if (!webhook) return null;
      try {
        await webhook.editMessage(record.messageId, payload);
        return { channel, webhook, messageId: record.messageId };
      } catch (error) {
        if (codeOf(error) === UNKNOWN_MESSAGE) await this.store.setPanel(guild.id, null, null); // 지워졌다. 다음 게시가 새로 올린다
        return null;
      }
    });
  }

  /** 패널을 지우고 기록을 비운다. 전용 채널을 풀었을 때 */
  remove(guild: PanelGuild | null | undefined) {
    if (!guild?.id) return Promise.resolve();
    return this._serial(guild.id, async () => {
      const old = await this.store.getPanel(guild.id);
      if (!old) return;
      await this.store.setPanel(guild.id, null, null);
      await this._delete(guild, old, {});
    });
  }

  async _channel(guild: PanelGuild, channelId: string | null) {
    if (!channelId) return null;
    return guild.channels?.cache?.get(channelId) ?? (await guild.channels?.fetch?.(channelId).catch(() => null)) ?? null;
  }

  // 웹훅으로 지우면 권한이 필요 없다. 웹훅이 없어졌거나 일반 메시지로 보냈으면 채널 권한으로. 안 되면 둔다.
  async _delete(guild: PanelGuild, { channelId, messageId }: PanelRecord, hint: { channel?: GuildBasedChannel; webhook?: Hook | null }) {
    const sameChannel = hint.channel?.id === channelId;
    const channel = sameChannel ? hint.channel : await this._channel(guild, channelId);
    if (!channel) return;
    const webhook = sameChannel && hint.webhook ? hint.webhook : await this.embeds.getOrCreateWebhook(channel);
    try {
      if (webhook) return await webhook.deleteMessage(messageId);
    } catch {
      /* 아래에서 채널 권한으로 */
    }
    if ("messages" in channel)
      await Promise.resolve(channel.messages.delete(messageId)).catch(() => {
        /* 이미 지워졌거나 지울 권한이 없다. 옛 패널이 남을 뿐이다 */
      });
  }
}

export { NowPlayingPanel };
export type { Store as PanelStore };
