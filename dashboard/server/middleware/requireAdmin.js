module.exports = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  if (!req.session.user.isAdmin) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  next();
};
