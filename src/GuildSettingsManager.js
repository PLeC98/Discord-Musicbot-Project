'use strict';

const fs = require('fs');
const path = require('path');
const CacheManager = require('./CacheManager');

// 구 node-json-db 시절의 저장 파일 — 발견 시 1회 SQLite로 이관 후 .bak으로 보존
const LEGACY_JSON = path.join(__dirname, '..', 'database', 'settings.json');

class GuildSettingsManager {
    constructor() {
        this.cache = new Map();
        this._migrateLegacyJson();
    }

    _migrateLegacyJson() {
        try {
            if (!fs.existsSync(LEGACY_JSON)) return;

            const data = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
            let migrated = 0;
            for (const [guildId, settings] of Object.entries(data?.guilds || {})) {
                if (settings?.botChannel) {
                    CacheManager.setBotChannel(guildId, settings.botChannel);
                    migrated++;
                }
            }

            // 샤딩 시 다른 프로세스가 먼저 리네임했을 수 있음 — ENOENT는 무시
            try {
                fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.bak');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            console.log(`[GuildSettings] settings.json → SQLite 마이그레이션 완료 (${migrated}건, 원본은 settings.json.bak 보존)`);
        } catch (error) {
            console.error('❌ [GuildSettings] settings.json 마이그레이션 실패:', error.message);
        }
    }

    async setBotChannel(guildId, channelId) {
        try {
            CacheManager.setBotChannel(guildId, channelId);
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
            const channelId = CacheManager.getBotChannel(guildId);
            this.cache.set(key, channelId);
            return channelId;
        } catch {
            this.cache.set(key, null);
            return null;
        }
    }

    async clearBotChannel(guildId) {
        try {
            CacheManager.clearBotChannel(guildId);
        } catch {}
        this.cache.delete(`${guildId}_botChannel`);
    }

    async setDjRoles(guildId, roleIds) {
        try {
            CacheManager.setDjRoles(guildId, roleIds);
            this.cache.set(`${guildId}_djRoles`, roleIds);
            return true;
        } catch (error) {
            console.error('❌ [GuildSettings] setDjRoles failed:', error);
            return false;
        }
    }

    /** DJ 역할 ID 목록 — 미설정이면 빈 배열 */
    async getDjRoles(guildId) {
        const key = `${guildId}_djRoles`;
        if (this.cache.has(key)) return this.cache.get(key);
        try {
            const roleIds = CacheManager.getDjRoles(guildId);
            this.cache.set(key, roleIds);
            return roleIds;
        } catch {
            this.cache.set(key, []);
            return [];
        }
    }

    async clearDjRoles(guildId) {
        try {
            CacheManager.clearDjRoles(guildId);
        } catch {}
        this.cache.delete(`${guildId}_djRoles`);
    }
}

module.exports = new GuildSettingsManager();
