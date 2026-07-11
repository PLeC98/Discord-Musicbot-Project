const DEV_ORIGIN = "http://localhost:5173";

function normalizeDashboardOrigin(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("DASHBOARD_URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("DASHBOARD_URL must be a plain origin");
  }
  return parsed.origin;
}

function createCorsOptions(dashboardUrl, nodeEnv = process.env.NODE_ENV) {
  const allowedOrigins = new Set([normalizeDashboardOrigin(dashboardUrl)]);
  if (nodeEnv !== "production") allowedOrigins.add(DEV_ORIGIN);

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      let normalized;
      try {
        normalized = new URL(origin).origin;
      } catch {
        return callback(null, false);
      }
      return callback(null, allowedOrigins.has(normalized) && normalized === origin.replace(/\/$/, ""));
    },
  };
}

module.exports = { createCorsOptions, normalizeDashboardOrigin };
