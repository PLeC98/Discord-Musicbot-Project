const { isOwner } = require("../owner");

// 봇 운영자(OWNER_ID) 전용 게이트. 길드의 "서버 관리" 권한과는 무관하다 —
// 그쪽은 permissions.js의 isModerator / 길드 목록의 canManageGuild가 다룬다.
module.exports = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  if (!isOwner(req)) return res.status(403).json({ error: "봇 운영자만 사용할 수 있습니다." });
  next();
};
