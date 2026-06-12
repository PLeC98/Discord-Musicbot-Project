const express = require('express');
const router = express.Router();
const requireAdmin = require('../middleware/requireAdmin');
const os = require('os');

// Bot/Node/System/Shard status
router.get('/status', requireAdmin, (req, res) => {
    const client = req.app.locals.discordClient;
    const uptime = process.uptime();
    const mem = process.memoryUsage();

    res.json({
        bot: {
            tag: client?.user?.tag || 'Connecting...',
            id: client?.user?.id || null,
            guilds: client?.guilds?.cache?.size || 0,
            ping: client?.ws?.ping || 0,
            status: client?.ws?.status ?? -1,
            uptime: {
                days: Math.floor(uptime / 86400),
                hours: Math.floor((uptime % 86400) / 3600),
                minutes: Math.floor((uptime % 3600) / 60),
                seconds: Math.floor(uptime % 60)
            }
        },
        node: {
            version: process.version,
            platform: process.platform,
            arch: process.arch,
            memory: {
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                rss: Math.round(mem.rss / 1024 / 1024)
            }
        },
        system: {
            cpus: os.cpus().length,
            totalMem: Math.round(os.totalmem() / 1024 / 1024),
            freeMem: Math.round(os.freemem() / 1024 / 1024),
            loadAvg: os.loadavg()
        },
        shards: client?.shard ? {
            ids: client.shard.ids,
            count: client.shard.count
        } : null,
        activePlayers: client?.players?.size || 0
    });
});

// Send announcement to all guilds
router.post('/broadcast', requireAdmin, async (req, res) => {
    const { message, type = 'maintenance' } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

    const client = req.app.locals.discordClient;
    if (!client?.isReady()) return res.status(503).json({ error: 'Bot not ready' });

    const { EmbedBuilder } = require('discord.js');

    const types = {
        maintenance: { color: '#FFA500', emoji: '🔧', title: '봇 점검 안내' },
        update:      { color: '#57F287', emoji: '🆕', title: '봇 업데이트 안내' },
        alert:       { color: '#ED4245', emoji: '⚠️', title: '긴급 공지' },
        info:        { color: '#5865F2', emoji: 'ℹ️', title: '공지사항' }
    };
    const cfg = types[type] || types.info;

    const embed = new EmbedBuilder()
        .setTitle(`${cfg.emoji} ${cfg.title}`)
        .setDescription(message.trim())
        .setColor(cfg.color)
        .setTimestamp()
        .setFooter({ text: '봇 관리자' });

    const GuildSettingsManager = require('../../../src/GuildSettingsManager');
    let sent = 0, failed = 0;

    for (const [, guild] of client.guilds.cache) {
        try {
            // Priority: bot channel → system channel → first available text channel
            let ch = null;

            const botChannelId = await GuildSettingsManager.getBotChannel(guild.id);
            if (botChannelId) {
                ch = guild.channels.cache.get(botChannelId);
                if (ch && !ch.permissionsFor(guild.members.me)?.has('SendMessages')) ch = null;
            }

            if (!ch) ch = guild.systemChannel;
            if (!ch || !ch.permissionsFor(guild.members.me)?.has('SendMessages')) {
                ch = guild.channels.cache
                    .filter(c => c.isTextBased() && !c.isThread() &&
                                 c.permissionsFor(guild.members.me)?.has('SendMessages'))
                    .sort((a, b) => a.position - b.position)
                    .first();
            }

            if (ch) { await ch.send({ embeds: [embed] }); sent++; }
            else failed++;
        } catch { failed++; }
    }

    res.json({ success: true, sent, failed, total: client.guilds.cache.size });
});

// List all guilds bot is in
router.get('/guilds', requireAdmin, (req, res) => {
    const client = req.app.locals.discordClient;
    if (!client?.isReady()) return res.status(503).json({ error: 'Bot not ready' });

    const guilds = [...client.guilds.cache.values()].map(g => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL({ size: 64 }),
        memberCount: g.memberCount,
        hasPlayer: client.players?.has(g.id) || false
    }));

    res.json({ guilds });
});

module.exports = router;
