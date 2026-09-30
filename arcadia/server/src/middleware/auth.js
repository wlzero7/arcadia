// ========================================
// ARCADIA - AUTH MIDDLEWARE (JWT)
// ========================================

const jwt = require("jsonwebtoken");

const JWT_SECRET =
    process.env.JWT_SECRET || "arcadia-dev-secret";

function authenticate(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
        ? header.slice(7)
        : req.cookies && req.cookies.arcadia_token;

    if (!token) {
        return res.status(401).json({
            status: "error",
            message: "Não autenticado.",
        });
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.user = {
            id: payload.id,
            username: payload.username,
        };
        next();
    } catch (err) {
        return res.status(401).json({
            status: "error",
            message: "Sessão expirada. Faça login novamente.",
        });
    }
}

module.exports = { authenticate, JWT_SECRET };
