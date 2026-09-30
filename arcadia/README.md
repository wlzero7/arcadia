# 🎰 Arcadia

**Arcadia — Social Casino Simulator** (v0.9.4 — Plinko + leilão no X1 + API otimizada)

Cassino social **100% free**: sem compras, sem microtransações, sem dinheiro real.
ArcCoins (AC) são fictícios — a graça é apostar **com os amigos**, do **pote compartilhado**.

## O que roda

- **Backend** (`server/`): Node + Express + **Socket.IO** + **SQLite** (node-sqlite3-wasm, arquivo em disco — sem instalar Postgres)
  - Auth JWT (bcrypt), carteira transacional com extrato
  - Jogos solo server-side: 🎲 Dados (6x), 🪙 Coinflip (2x), 💣 **Mines** (start/pick/cashout), 🚀 **Crash** (animado), 🃏 **Blackjack** (hit/stand/double, 3:2), 🎡 **Roleta europeia** (pleno/cores/paridade/dúzias)
  - Bônus diário com streak + transferência entre jogadores
  - **Salas multiplayer** em tempo real: pote compartilhado, stakes, saque, chat, histórico — Dados / Coinflip / Crash do Grupo
  - 🏆 **Ranking** global (top 20 por lucro)
- **Frontend** (`js/`, `css/`, `*.html`): páginas existentes + nova `rooms.html` (salas multiplayer)

## Rodando

```bash
cd server
npm install
npm run dev        # API + Socket.IO + FRONTEND em http://localhost:8899
```

**A partir da v0.6 o próprio Express serve o frontend** — um serviço só.
Abra http://localhost:8899 direto (não precisa mais de Live Server).
Para deploy: `docker build -t arcadia . && docker run -p 8899:8899 arcadia`
ou Render/Railway/Fly.io apontando para `server/`.

## Regras do pote compartilhado

1. Cada jogador **deposita** AC do próprio saldo no pote da sala.
2. Qualquer um **aposta do pote** — ganhou, o prêmio volta pro pote; perdeu, o pote paga.
3. Cada um **saca** até o valor do próprio stake (o pote precisa ter saldo).
4. Host sai? O próximo vira host. Sala vazia? Fecha.

## ArcCoins

AC não tem valor monetário, não é comprado, não é sacado, não é criptomoeda.

## Status

- v0.1 — Foundation (auth + wallet local)
- v0.2 — API + JWT
- v0.3 — **Multiplayer: salas com pote compartilhado (Socket.IO + SQLite)**
- v0.4 — **Mines interativo + Crash animado + Ranking global**
- v0.5 — **Amigos (pedidos/aceitar/remover) + Perfil com extrato e transferência**
- v0.6 — **Deploy-ready: Express serve o frontend estático + Dockerfile + .env.example**
- v0.7 — **Salas multiplayer persistidas no SQLite** (sobrevivem a restart)
- v0.8 — **Blackjack completo (hit/stand/double, 3:2) + Roleta europeia (pleno 36x, cores, dúzias)**
- v0.9.4-fix — **🐛 Correções: botões de jogos mortos no hub (getBalance inexistente quebrava games.js), cache de 24h em JS servindo versão bugada (agora no-cache/ETag), slogan antigo no hero, link Sobre duplicado, Início com href="#"**
- v0.9.4 — **🎯 Plinko (16 fileiras, 3 riscos, até 1000x) · 🔨 Leilão no X1: 5 modos sorteados, melhor lance (da carteira Duelo) escolhe o modo · ⚡ API otimizada (gzip, cache de assets, rate limit, keepAlive para proxies)**
- v0.9.1 — **🔊 Motor de sons próprio (WebAudio, zero arquivos): dados rolando, explosões, cartas, fichas, vitórias, foguete, cascos, roleta girando, level-up — com botão de mute global · ✨ Visual polido (scrollbar custom, glow no logo, elevação de botões/cards, animações de entrada, focus states) · 📱 Responsividade completa mobile/PC (nav empilhada, grids em 1 coluna, mesas adaptadas, cartas menores)**
- v0.9 — **🐎 Corrida de Cavalos multiplayer (Barry, Clade, Lucy, Nicolas, Augusto...), ⚔️ Duelo x1 (falência = derrota, carteira própria), 🎴 Blackjack MP com cartas especiais (6 raridades: comum→cromática) + NRG, 🎡 Roleta do grupo (todos apostam no mesmo giro), carteiras separadas solo/coop/duelo, XP e level 1→999, conquistas, missões diárias/semanais, perfil com avatar editável**
