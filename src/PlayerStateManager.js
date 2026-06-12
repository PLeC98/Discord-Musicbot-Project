'use strict';

/**
 * PlayerStateManager — thin compatibility shim over CacheManager.
 *
 * All player session data is now stored in the SQLite DB managed by CacheManager
 * (player_sessions table). This file exists only so that any third-party code or
 * dashboard that still references PlayerStateManager continues to work unchanged.
 */
const CacheManager = require('./CacheManager');

class PlayerStateManager {
    async saveState(guildId, state) {
        if (!guildId || !state) return;
        CacheManager.savePlayerSession(guildId, state);
    }

    getState(guildId) {
        if (!guildId) return null;
        return CacheManager.getPlayerSession(guildId);
    }

    getAllStates() {
        return CacheManager.getAllPlayerSessions();
    }

    async removeState(guildId) {
        if (!guildId) return;
        CacheManager.removePlayerSession(guildId);
    }

    async clearAllStates() {
        const sessions = CacheManager.getAllPlayerSessions();
        for (const guildId of Object.keys(sessions)) {
            CacheManager.removePlayerSession(guildId);
        }
    }

    getProtectedCacheFiles() {
        return CacheManager.getProtectedCacheFiles();
    }
}

module.exports = new PlayerStateManager();
