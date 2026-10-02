// ========================================
// ARCADIA - DATABASE (SQLite via node-sqlite3-wasm)
// Fallback leve de PostgreSQL: mesma API async, arquivo em disco.
// ========================================

const path = require("path");
const fs = require("fs");
const { Database } = require("node-sqlite3-wasm");
const { emitBalanceChange } = require("../services/balanceBus");

const DB_PATH =
    process.env.DB_PATH || "./data/arcadia.db";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL = leituras concorrentes + durabilidade
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ========================================
// SCHEMA
// ========================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    avatar TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'solo' CHECK (kind IN ('solo','coop','duel')),
    balance INTEGER NOT NULL DEFAULT 10000 CHECK (balance >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, kind)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('bet','payout','daily_bonus','room_stake','room_payout','room_refund','transfer_in','transfer_out')),
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    ref_type TEXT,
    ref_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    wager INTEGER NOT NULL,
    multiplier REAL NOT NULL DEFAULT 0,
    payout INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    host_id INTEGER NOT NULL REFERENCES users(id),
    game TEXT NOT NULL DEFAULT 'dice',
    max_players INTEGER NOT NULL DEFAULT 8,
    min_bet INTEGER NOT NULL DEFAULT 10,
    max_bet INTEGER NOT NULL DEFAULT 1000,
    status TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby','playing','finished','closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_members (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('host','player')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_pot (
    room_id INTEGER PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS friendships (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS daily_bonus (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_claim TEXT NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key TEXT NOT NULL,
    unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, achievement_key)
);

CREATE TABLE IF NOT EXISTS user_missions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_key TEXT NOT NULL,
    period TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    claimed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, mission_key, period)
);

CREATE TABLE IF NOT EXISTS duel_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tx_wallet ON transactions(wallet_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
`;

db.exec(SCHEMA);

// ========================================
// MIGRAÇÕES (bancos criados antes da v0.9)
// ========================================

for (const col of ["display_name TEXT", "avatar TEXT DEFAULT '🎰'", "xp INTEGER NOT NULL DEFAULT 0", "level INTEGER NOT NULL DEFAULT 1"]) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (_) {}
}

// wallets: adiciona kind e recria se veio do schema antigo (user_id UNIQUE)
const walletCols = db.all("PRAGMA table_info(wallets)").map((r) => r.name);
if (!walletCols.includes("kind")) {
    db.exec(`
        CREATE TABLE wallets_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'solo' CHECK (kind IN ('solo','coop','duel')),
            balance INTEGER NOT NULL DEFAULT 10000 CHECK (balance >= 0),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (user_id, kind)
        );
        INSERT INTO wallets_new (id, user_id, kind, balance, updated_at)
            SELECT id, user_id, 'solo', balance, updated_at FROM wallets;
        DROP TABLE wallets;
        ALTER TABLE wallets_new RENAME TO wallets;
    `);
}

// Garante carteiras solo/duel para todos os usuários
db.exec(`
    INSERT OR IGNORE INTO wallets (user_id, kind, balance)
        SELECT id, 'solo', 10000 FROM users;
    INSERT OR IGNORE INTO wallets (user_id, kind, balance)
        SELECT id, 'duel', 1000 FROM users;
`);

// Upgrade retroativo de saldos antigos (10k/1k → 1M) — config do William
db.exec(`
    UPDATE wallets SET balance = 1000000 WHERE kind = 'solo' AND balance = 10000;
    UPDATE wallets SET balance = 1000000 WHERE kind = 'coop' AND balance = 10000;
    UPDATE wallets SET balance = 1000000 WHERE kind = 'duel' AND balance = 1000;
`);

// ========================================
// HELPERS (mesma assinatura do pg: err-first)
// ========================================

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        try {
            const rows = db.all(sql, params);
            resolve({ rows, rowCount: rows.length });
        } catch (err) {
            reject(err);
        }
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        try {
            resolve(db.get(sql, params) || null);
        } catch (err) {
            reject(err);
        }
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        try {
            const info = db.run(sql, params);
            resolve({ changes: info.changes, lastInsertRowid: info.lastInsertRowid });
        } catch (err) {
            reject(err);
        }
    });
}

// Transação síncrona: sqlite-wasm é single-thread, então o bloco
// inteiro roda sem interleaving — atomicidade de graça.
function transaction(fn) {
    return new Promise((resolve, reject) => {
        try {
            db.exec("BEGIN");
            const result = fn();
            db.exec("COMMIT");
            resolve(result);
        } catch (err) {
            try { db.exec("ROLLBACK"); } catch (_) {}
            reject(err);
        }
    });
}

// ========================================
// CARTEIRA: débito/crédito com transação + log + evento realtime (v0.9.7)
// Toda transação de carteira passa por aqui — é o gargalo único.
// Depois de persistir, emite balance:changed no barramento com o kind
// da carteira tocada (solo/coop/duel) — cada uma atualiza independente.
// ========================================

function adjustBalance(walletId, delta, kind, refType = null, refId = null) {
    return transaction(() => {
        const wallet = db.get("SELECT id, user_id, kind, balance FROM wallets WHERE id = ?", [walletId]);
        if (!wallet) throw new Error("Carteira não encontrada.");

        const newBalance = wallet.balance + delta;
        if (newBalance < 0) {
            throw new Error("Saldo insuficiente.");
        }

        db.run(
            "UPDATE wallets SET balance = ?, updated_at = datetime('now') WHERE id = ?",
            [newBalance, walletId]
        );

        db.run(
            `INSERT INTO transactions (wallet_id, kind, amount, balance_after, ref_type, ref_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [walletId, kind, delta, newBalance, refType, refId]
        );

        // realtime: só o dono da carteira recebe (sala user:<id>)
        emitBalanceChange({
            userId: wallet.user_id,
            kind: wallet.kind,
            balance: newBalance,
            delta,
        });

        return newBalance;
    });
}

// Carteira por tipo (solo | coop | duel) — cria se não existir — 1.000.000 AC (config do William)
function getWallet(userId, kind = "solo") {
    return transaction(() => {
        let w = db.get("SELECT * FROM wallets WHERE user_id = ? AND kind = ?", [userId, kind]);
        if (!w) {
            const initial = 1000000;
            db.run("INSERT INTO wallets (user_id, kind, balance) VALUES (?, ?, ?)", [userId, kind, initial]);
            w = db.get("SELECT * FROM wallets WHERE user_id = ? AND kind = ?", [userId, kind]);

            // carteira recém-criada também emite (estado inicial pro front)
            emitBalanceChange({
                userId,
                kind,
                balance: w.balance,
                delta: initial,
            });
        }
        return w;
    });
}

module.exports = {
    getWallet,
    db,
    query,
    get,
    run,
    transaction,
    adjustBalance,
    DB_PATH,
};
