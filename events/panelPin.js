"use strict";

// 전용 채널에 메시지가 올라오면 끝난 패널을 맨 아래로 — 재생 중인 패널은 5초 갱신이 맡는다.

const { Events } = require("discord.js");

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return;
    await message.client.musicEmbedManager?.scheduleIdleRepin(message.guild, message.channel.id);
  },
};
