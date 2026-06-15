const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const config = require('../../../config');

const MANAGE_GUILD = 0x20;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPlayer(req, res, guildId) {
    const client = req.app.locals.discordClient;
    if (!client?.isReady()) { res.status(503).json({ error: 'Bot not ready' }); return null; }

    const inGuild = req.session.user.isAdmin ||
                    req.session.user.guilds?.some(g => g.id === guildId);
    if (!inGuild) { res.status(403).json({ error: 'Access denied' }); return null; }

    return { client, player: client.players?.get(guildId) || null };
}

function playerState(player) {
    if (!player) return { playing: false, paused: false, queue: [], currentTrack: null };
    const status = player.getStatus();
    const track = player.currentTrack;
    return {
        playing: status.playing,
        paused: status.paused,
        volume: status.volume,
        loop: status.loop,
        shuffle: status.shuffle,
        currentTrack: track ? {
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnail: track.thumbnail,
            url: track.url,
            platform: track.platform,
            currentTime: Math.floor((player.getCurrentTime?.() || 0) / 1000),
            requestedBy: track.requestedBy
                ? { id: track.requestedBy.id, username: track.requestedBy.username }
                : null
        } : null,
        hasPrevious: (player.previousTracks?.length ?? 0) > 0,
        queue: (player.queue || []).map((t, i) => ({
            index: i,
            title: t.title,
            artist: t.artist,
            duration: t.duration,
            thumbnail: t.thumbnail,
            platform: t.platform,
            requestedBy: t.requestedBy
                ? { id: t.requestedBy.id, username: t.requestedBy.username }
                : null
        }))
    };
}

// ── Read endpoints ────────────────────────────────────────────────────────────

// Mutual guilds (user + bot)
router.get('/', requireAuth, (req, res) => {
    const client = req.app.locals.discordClient;
    if (!client?.isReady()) return res.status(503).json({ error: 'Bot not ready' });

    const mutual = (req.session.user.guilds || [])
        .filter(g => client.guilds.cache.has(g.id))
        .map(g => ({
            id: g.id,
            name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64` : null,
            isAdmin: (parseInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD,
            hasPlayer: client.players?.has(g.id) || false,
            memberCount: client.guilds.cache.get(g.id).memberCount
        }));

    res.json({ guilds: mutual });
});

// Player state
router.get('/:guildId/player', requireAuth, (req, res) => {
    const { guildId } = req.params;
    const ctx = getPlayer(req, res, guildId);
    if (!ctx) return;
    const { client } = ctx;

    const guild = client.guilds.cache.get(guildId);
    const botInVoice = !!guild?.members?.me?.voice?.channel;
    const userMember = guild?.members?.cache?.get(req.session.user.id);
    const userInVoice = !!userMember?.voice?.channel;

    res.json({ ...playerState(ctx.player), botInVoice, userInVoice });
});

// ── Control endpoints ─────────────────────────────────────────────────────────

// Join user's voice channel
router.post('/:guildId/player/join', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const ctx = getPlayer(req, res, guildId);
    if (!ctx) return;
    const { client } = ctx;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    let member;
    try {
        member = await guild.members.fetch(req.session.user.id);
    } catch (e) {
        return res.status(400).json({ error: '서버에서 사용자를 찾을 수 없습니다' });
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) return res.status(400).json({ error: '음성 채널에 참가해 있지 않습니다' });

    const permissions = voiceChannel.permissionsFor(guild.members.me);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return res.status(403).json({ error: '봇이 해당 채널에 접속할 권한이 없습니다' });
    }

    let player = client.players.get(guildId);
    if (!player) {
        const MusicPlayer = require('../../../src/MusicPlayer');
        const MusicEmbedManager = require('../../../src/MusicEmbedManager');
        if (!client.musicEmbedManager) {
            client.musicEmbedManager = new MusicEmbedManager(client);
        }
        player = new MusicPlayer(guild, null, voiceChannel);
        client.players.set(guildId, player);
    } else {
        player.voiceChannel = voiceChannel;
    }

    try {
        await player.connect();
    } catch (e) {
        player.releaseResources();
        player.disconnect();
        client.players.delete(guildId);
        return res.status(500).json({ error: '음성 채널 접속에 실패했습니다' });
    }

    if (!player.currentTrack) {
        player.updateVoiceStatus(config.voiceStatus.idleText).catch(() => {});
    }

    const botInVoice = !!guild?.members?.me?.voice?.channel;
    const userInVoice = !!member?.voice?.channel;
    res.json({ ...playerState(player), botInVoice, userInVoice });
});

// Toggle pause / resume
router.post('/:guildId/player/pause', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player, client } = ctx;
    if (!player?.currentTrack) return res.status(409).json({ error: 'Nothing playing' });

    if (player.paused) {
        player.resume();
    } else {
        player.pause();
    }

    if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
    res.json(playerState(player));
});

// Previous
router.post('/:guildId/player/previous', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player } = ctx;
    if (!player?.currentTrack) return res.status(409).json({ error: 'Nothing playing' });
    if (!player.previousTracks?.length) return res.status(409).json({ error: 'No previous track' });

    player.previous();
    res.json({ ok: true });
});

// Skip
router.post('/:guildId/player/skip', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player, client } = ctx;
    if (!player?.currentTrack) return res.status(409).json({ error: 'Nothing playing' });

    player.skip();
    res.json({ ok: true });
});

// Stop
router.post('/:guildId/player/stop', requireAuth, (req, res) => {
    const { guildId } = req.params;
    const ctx = getPlayer(req, res, guildId);
    if (!ctx) return;
    const { player, client } = ctx;
    if (!player) return res.status(409).json({ error: 'Nothing playing' });

    player.stop();
    client.players.delete(guildId);
    if (client.musicEmbedManager) client.musicEmbedManager.handlePlaybackEnd(player).catch(() => {});
    res.json({ ok: true });
});

// Seek  { position: seconds }
router.post('/:guildId/player/seek', requireAuth, async (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player } = ctx;
    if (!player?.currentTrack) return res.status(409).json({ error: 'Nothing playing' });

    const positionSec = parseFloat(req.body.position);
    if (isNaN(positionSec) || positionSec < 0) return res.status(400).json({ error: 'Invalid position' });

    const durationSec = player.currentTrack.duration ?? 0;
    const clampedSec = durationSec > 0 ? Math.min(positionSec, durationSec - 1) : positionSec;

    try {
        await player.play(null, Math.floor(clampedSec * 1000));
        res.json({ ok: true, position: clampedSec });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Volume  { volume: 0-100 }
router.post('/:guildId/player/volume', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player } = ctx;
    if (!player) return res.status(409).json({ error: 'Nothing playing' });

    const vol = parseInt(req.body.volume);
    if (isNaN(vol) || vol < 0 || vol > 100) return res.status(400).json({ error: 'Volume must be 0-100' });

    player.setVolume(vol);
    res.json(playerState(player));
});

// Loop  { mode: 'off' | 'track' | 'queue' }
router.post('/:guildId/player/loop', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player, client } = ctx;
    if (!player?.currentTrack) return res.status(409).json({ error: 'Nothing playing' });

    const mode = req.body.mode;
    if (!['off', 'track', 'queue'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });

    player.loop = mode === 'off' ? false : mode;
    if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
    res.json(playerState(player));
});

// Shuffle
router.post('/:guildId/player/shuffle', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player, client } = ctx;
    if (!player || player.queue.length < 2) return res.status(409).json({ error: 'Need at least 2 songs in queue' });

    player.shuffleQueue();
    if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
    res.json(playerState(player));
});

// Add track to queue  { query: string }
router.post('/:guildId/player/queue', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const ctx = getPlayer(req, res, guildId);
    if (!ctx) return;
    const { player, client } = ctx;

    if (!player) return res.status(409).json({ error: 'Bot is not in a voice channel. Start music via Discord first.' });

    const query = req.body.query?.trim();
    if (!query) return res.status(400).json({ error: 'Query required' });

    console.log(`[Play] Dashboard | guild=${guildId} | user=${req.session.user.globalName || req.session.user.username} | query="${query}"`);

    try {
        const requester = {
            id: req.session.user.id,
            username: req.session.user.globalName || req.session.user.username
        };

        // addTrack() starts playback itself when the player was idle —
        // calling play() again here would restart the track from the beginning
        const result = await player.addTrack(query, requester);

        if (!result.success) return res.status(400).json({ error: result.message });

        if (client.musicEmbedManager && player.currentTrack) {
            client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
        }

        res.json(playerState(player));
    } catch (err) {
        console.error('Dashboard addTrack error:', err);
        res.status(500).json({ error: 'Failed to add track' });
    }
});

// Remove track from queue  DELETE /:guildId/player/queue/:index
router.delete('/:guildId/player/queue/:index', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player } = ctx;
    if (!player) return res.status(409).json({ error: 'Nothing playing' });

    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= player.queue.length) {
        return res.status(400).json({ error: 'Invalid queue index' });
    }

    player.removeFromQueue(index);
    res.json(playerState(player));
});

// Move track in queue  { from: number, to: number }
router.post('/:guildId/player/queue/move', requireAuth, (req, res) => {
    const ctx = getPlayer(req, res, req.params.guildId);
    if (!ctx) return;
    const { player, client } = ctx;
    if (!player) return res.status(409).json({ error: 'Nothing playing' });

    const from = parseInt(req.body.from);
    const to   = parseInt(req.body.to);

    if (isNaN(from) || isNaN(to) || from < 0 || to < 0 ||
        from >= player.queue.length || to >= player.queue.length) {
        return res.status(400).json({ error: 'Invalid queue indices' });
    }

    player.moveInQueue(from, to);
    if (client.musicEmbedManager) client.musicEmbedManager.updateNowPlayingEmbed(player).catch(() => {});
    res.json(playerState(player));
});

module.exports = router;
