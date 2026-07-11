const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

function issueCsrfToken(req, res) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  res.set("Cache-Control", "no-store");
  return res.json({ csrfToken: ensureCsrfToken(req) });
}

function requireCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session?.csrfToken;
  const supplied = req.get("x-csrf-token");
  if (typeof expected !== "string" || typeof supplied !== "string") {
    return res.status(403).json({ error: "Invalid CSRF token.", code: "INVALID_CSRF_TOKEN" });
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(403).json({ error: "Invalid CSRF token.", code: "INVALID_CSRF_TOKEN" });
  }

  return next();
}

module.exports = { ensureCsrfToken, issueCsrfToken, requireCsrfToken };
