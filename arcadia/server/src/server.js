// ========================================
// ARCADIA - SERVER (Express + Socket.IO + SQLite)
// v1.0.2: /api/games/slots montado ANTES do /api/games
// (o coringa /:game/play sequestrava a rota do Slots → "Jogo não encontrado")
// ========================================

require("dotenv").config();

const express = require("express");
const compression = require("compression");
const cors = require("cors");
const http = require("http");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");

const pool = require("./config/database");
const authRoutes = require("./routes/auth.routes");
const { router: gameRoutes } = require("./routes/game.routes");
const walletRoutes = require("./routes/wallet.routes");
const friendsRoutes = require("./routes/friends.routes");
const blackjackRoutes = require("./routes/blackjack.routes");
const rouletteRoutes = require("./routes/roulette.routes");
const slotsRoutes = require("./routes/slots.routes");
const { setupMultiplayer } = require("./realtime/rooms");
const { setupBlackjackMultiplayer } = require("./realtime/blackjack-mp");
const { setupRacing } = require("./realtime/racing");
const { setupDuels } = require("./realtime/duels");
const { initInvites } = require("./realtime/invites");
const progression = require("./services/progression.routes");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// ========================================
// MIDDLEWARES
// ========================================

app.use(
    cors({
        origin: true, // dev: libera qualquer origem (Live Server etc.)
        credentials: true,
    })
);

app.use(compression()); // gzip nas respostas
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());

// Cache: HTML sempre revalida; JS/CSS revalidam via ETag (rápido, 304) mas nunca ficam velhos.
// (max-age longo aqui serviu versão bugada por 24h na v0.9.4 — nunca mais)
app.use((req, res, next) => {
    if (req.path.match(/\.(css|js|png|jpg|svg|ico|woff2?)$/)) {
        res.setHeader("Cache-Control", "no-cache"); // revalida: 304 se não mudou
    } else if (req.path.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
    }
    next();
});

// Rate limit simples por IP (proteção básica da API)
const rateHits = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    const rec = rateHits.get(ip) || { count: 0, reset: now + 60000 };
    if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
    rec.count++;
    rateHits.set(ip, rec);
    if (rateHits.size > 5000) rateHits.clear(); // evita vazamento de memória
    if (rec.count > 300) {
        return res.status(429).json({ status: "error", message: "Muitas requisições. Aguarde um minuto." });
    }
    next();
});

// ========================================
// ROTAS
// ⚠️ ORDEM IMPORTA: rotas específicas ANTES de rotas com coringa.
// /api/games/slots precisa vir antes de /api/games (que tem /:game/play).
// ========================================

app.use("/api/auth", authRoutes);
app.use("/api/games/slots", slotsRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/games", blackjackRoutes);
app.use("/api/games", rouletteRoutes);
app.use("/api/progression", progression.router);

// ========================================
// HEALTH
// ========================================

app.get("/api/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        application: "Arcadia API",
        version: "0.9.0",
        realtime: true,
    });
});

app.get("/api/database/health", async (req, res) => {
    try {
        const result = await pool.get("SELECT datetime('now') AS database_time");
        res.status(200).json({
            status: "ok",
            database: "SQLite",
            connected: true,
            time: result ? result.database_time : null,
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            database: "SQLite",
            connected: false,
        });
    }
});

// Frontend estático pelo próprio Express (deploy em 1 serviço)
const path = require("path");
app.use(express.static(path.join(__dirname, "..", "..")));

// ========================================
// SOCKET.IO
// ========================================

const io = new Server(server, {
    cors: { origin: true, credentials: true },
});

setupMultiplayer(io);
setupBlackjackMultiplayer(io);
setupRacing(io);
setupDuels(io);
initInvites(io);

// ========================================
// START
// ========================================

server.keepAliveTimeout = 65000; // evita 502 em proxies com idle > 5s
server.headersTimeout = 66000;

server.listen(PORT, () => {
    console.log(`🎰 Arcadia API v0.3.0 — http://localhost:${PORT}`);
    console.log(`   Banco: ${pool.DB_PATH}`);
    console.log(`   Realtime: Socket.IO ativo`);
});
