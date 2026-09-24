const exported = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  next();
};
export default exported;
export { exported as "module.exports" };
