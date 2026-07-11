const crypto = require("crypto");

function createPlayerSessionId() {
  // 144 bits keeps the custom ID compact while making collisions and guesses impractical.
  return crypto.randomBytes(18).toString("base64url");
}

module.exports = createPlayerSessionId;
