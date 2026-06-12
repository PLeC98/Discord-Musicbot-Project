const express = require('express');
const axios = require('axios');
const router = express.Router();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'http://localhost:33333').replace(/\/$/, '');
const REDIRECT_URI = `${DASHBOARD_URL}/auth/callback`;
const OWNER_ID = process.env.OWNER_ID;

const DISCORD_API = 'https://discord.com/api/v10';

// Log OAuth config at startup for debugging
console.log(`[Dashboard Auth] CLIENT_ID: ${CLIENT_ID}`);
console.log(`[Dashboard Auth] REDIRECT_URI: ${REDIRECT_URI}`);
console.log(`[Dashboard Auth] OWNER_ID: ${OWNER_ID || '(not set)'}`);

// Redirect to Discord OAuth
router.get('/login', (req, res) => {
    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds'
    });
    res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
});

// OAuth2 callback
router.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    try {
        // Exchange code for access token
        const tokenRes = await axios.post(
            `${DISCORD_API}/oauth2/token`,
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, token_type } = tokenRes.data;
        const authHeader = `${token_type} ${access_token}`;

        // Fetch user + guilds in parallel
        const [userRes, guildsRes] = await Promise.all([
            axios.get(`${DISCORD_API}/users/@me`, { headers: { Authorization: authHeader } }),
            axios.get(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: authHeader } })
        ]);

        const user = userRes.data;

        req.session.user = {
            id: user.id,
            username: user.username,
            globalName: user.global_name || user.username,
            avatar: user.avatar,
            isAdmin: user.id === OWNER_ID,
            guilds: guildsRes.data
        };

        req.session.save(() => res.redirect('/dashboard'));

    } catch (error) {
        const discordErr = error.response?.data;
        console.error('❌ OAuth callback error:');
        console.error('  Status:', error.response?.status);
        console.error('  Body:', JSON.stringify(discordErr));
        console.error('  REDIRECT_URI used:', REDIRECT_URI);
        res.redirect('/?error=auth_failed');
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
