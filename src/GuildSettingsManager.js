const { JsonDB, Config } = require('node-json-db');
const path = require('path');

// Resolve against this file's location, not the process CWD — keeps the DB
// in <project>/database/ regardless of where the bot is launched from
const db = new JsonDB(new Config(path.join(__dirname, '..', 'database', 'settings'), true, true, '/'));

class GuildSettingsManager {
    constructor() {
        this.cache = new Map();
    }

    async setBotChannel(guildId, channelId) {
        try {
            await db.push(`/guilds/${guildId}/botChannel`, channelId);
            this.cache.set(`${guildId}_botChannel`, channelId);
            return true;
        } catch (error) {
            console.error('❌ [GuildSettings] setBotChannel failed:', error);
            return false;
        }
    }

    async getBotChannel(guildId) {
        const key = `${guildId}_botChannel`;
        if (this.cache.has(key)) return this.cache.get(key);
        try {
            const channelId = await db.getData(`/guilds/${guildId}/botChannel`);
            this.cache.set(key, channelId);
            return channelId;
        } catch {
            this.cache.set(key, null);
            return null;
        }
    }

    async clearBotChannel(guildId) {
        try {
            await db.delete(`/guilds/${guildId}/botChannel`);
        } catch {}
        this.cache.delete(`${guildId}_botChannel`);
    }
}

module.exports = new GuildSettingsManager();
