// Load .env from the project root regardless of the launch CWD
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const chalk = require("chalk");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const guildsRoutes = require("./routes/guilds");

const PORT = parseInt(process.env.DASHBOARD_PORT) || 33333;
const SESSION_SECRET = process.env.SESSION_SECRET || "musicbot-dashboard-fallback-secret-change-me";
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${PORT}`;

function startDashboard(client) {
  const app = express();

  // Trust X-Forwarded-* headers only from private-network proxies
  // (Caddy on the same machine or on the LAN). Headers arriving directly
  // from public addresses are ignored, so clients cannot spoof them.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");

  app.use(express.json());
  app.use(
    cors({
      origin: [DASHBOARD_URL, "http://localhost:5173"],
      credentials: true,
    }),
  );
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // 'auto': Secure attribute follows the actual connection —
        // set when served over HTTPS (via trusted proxy), omitted on
        // plain http://localhost so local testing keeps working
        secure: "auto",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // Make Discord client available to routes
  app.locals.discordClient = client;

  // Auth routes (/auth/login, /auth/callback, /auth/logout)
  app.use("/auth", authRoutes);

  // API routes
  app.use("/api/admin", adminRoutes);
  app.use("/api/guilds", guildsRoutes);

  // Current user endpoint
  app.get("/api/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
    res.json(req.session.user);
  });

  // Public bot info (used on login page before auth)
  app.get("/api/bot", (req, res) => {
    const botUser = client?.user;
    if (!botUser) return res.status(503).json({ error: "Bot not ready" });
    res.json({
      name: botUser.username,
      avatarUrl: botUser.avatarURL({ size: 256, extension: "webp" }) || null,
      sourceRepo: process.env.SOURCE_REPO_URL || null, // AGPL source disclosure
    });
  });

  // Serve built Vue app
  const clientDist = path.join(__dirname, "../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/auth")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  } else {
    app.get("/", (req, res) => {
      res.send("<h2>Dashboard client not built yet.<br>Run: <code>cd dashboard/client && pnpm install && pnpm build</code></h2>");
    });
  }

  app.listen(PORT, () => {
    console.log(chalk.green(`🌐 Dashboard: http://localhost:${PORT}`));
  });

  return app;
}

module.exports = { startDashboard };
