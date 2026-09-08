const { isRealOwner } = require("../owner");

// 봇 운영자(OWNER_ID) 전용 게이트. 디스코드 서버 쪽 권한과는 무관하다 —
// 그쪽은 permissions.js의 isModerator가 다룬다.
// 권한 수준 오버라이드를 무시하는 것은 의도적이다: 오버라이드 해제 수단이 이 라우터 안에 있어서,
// 여기까지 낮추면 운영자가 스스로를 잠근다.
module.exports = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  if (!isRealOwner(req)) return res.status(403).json({ error: "봇 운영자만 사용할 수 있습니다." });
  next();
};
