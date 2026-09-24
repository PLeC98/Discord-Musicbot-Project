// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
const exported = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: "로그인이 필요합니다." });
  next();
};
export default exported;
export { exported as "module.exports" };
