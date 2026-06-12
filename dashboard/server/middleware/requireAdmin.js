module.exports = (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });
    if (!req.session.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
};
