"use strict";

// 서버당 하나뿐인 현재 재생 패널의 자리 — 어느 채널의 어느 메시지인지 DB에 남긴다.
// 메모리 참조(player.nowPlayingMessage)는 재생이 끝나거나 재시작하면 없어지므로, 옛 패널을 치우는 기준은 이 기록이다.

const GuildSettingsManager = require("./GuildSettingsManager");

class NowPlayingPanel {
  /**
   * @param {{ getOrCreateWebhook(channel): Promise<object|null> }} embeds 웹훅을 다시 찾는 쪽(MusicEmbedManager)
   * @param {{ getPanel, setPanel }} store 기록 저장소 — 테스트가 갈아끼운다
   */
  constructor(embeds, store = GuildSettingsManager) {
    this.embeds = embeds;
    this.store = store;
    this.chains = new Map(); // guildId → Promise 꼬리 — 기록을 읽고 바꾸는 사이에 다른 게시가 끼지 않게
  }

  _serial(guildId, fn) {
    const run = (this.chains.get(guildId) || Promise.resolve()).catch(() => {}).then(fn);
    this.chains.set(guildId, run);
    return run.finally(() => {
      if (this.chains.get(guildId) === run) this.chains.delete(guildId);
    });
  }

  /** 방금 올린 메시지를 이 서버의 패널로 삼는다. 기록돼 있던 옛 패널은 지운다. */
  commit(guild, channel, message, webhook = null) {
    if (!guild?.id || !channel?.id || !message?.id) return Promise.resolve();
    return this._serial(guild.id, async () => {
      const old = await this.store.getPanel(guild.id);
      await this.store.setPanel(guild.id, channel.id, message.id);
      if (old && old.messageId !== message.id) await this._delete(guild, old, { channel, webhook });
    });
  }

  // 웹훅으로 지우면 권한이 필요 없다. 웹훅이 없어졌거나 일반 메시지로 보냈으면 채널 권한으로 — 안 되면 둔다.
  async _delete(guild, { channelId, messageId }, hint) {
    const sameChannel = hint.channel?.id === channelId;
    const channel = sameChannel ? hint.channel : (guild.channels?.cache?.get(channelId) ?? (await guild.channels?.fetch?.(channelId).catch(() => null)));
    if (!channel) return;
    const webhook = sameChannel && hint.webhook ? hint.webhook : await this.embeds.getOrCreateWebhook(channel);
    try {
      if (webhook) return await webhook.deleteMessage(messageId);
    } catch {
      /* 아래에서 채널 권한으로 */
    }
    await Promise.resolve(channel.messages?.delete(messageId)).catch(() => {});
  }
}

module.exports = NowPlayingPanel;
