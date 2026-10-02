// ========================================
// ARCADIA SFX — motor de sons (WebAudio, zero arquivos)
// v2.0: cadeia master com compressor, envelopes com attack,
// panorâmica estéreo, efeitos de UI automáticos (aba, navegação,
// modal) e sons novos por raridade de carta.
// ========================================

const Sfx = (() => {

    let ctx = null;
    let master = null;
    let enabled = localStorage.getItem("arcadia_sfx") !== "off";

    function ac() {
        if (!ctx) {
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
                // cadeia master: tudo passa pelo compressor → som mais cheio, sem clipar
                master = ctx.createGain();
                master.gain.value = 0.9;
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -18;
                comp.knee.value = 22;
                comp.ratio.value = 5;
                comp.attack.value = 0.004;
                comp.release.value = 0.18;
                master.connect(comp).connect(ctx.destination);
            } catch (_) {
                return null;
            }
        }
        // browsers exigem gesto do usuário antes de tocar
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
    }

    // panorâmica estéreo (fallback seguro se o browser não suportar)
    function panner(pan = 0) {
        const c = ac();
        if (!c) return null;
        if (c.createStereoPanner) {
            const p = c.createStereoPanner();
            p.pan.value = Math.max(-1, Math.min(1, pan));
            return p;
        }
        return c.createGain();
    }

    // tom com envelope suave (attack evita o "estalo" digital)
    function tone({ freq = 440, type = "sine", dur = 0.15, vol = 0.15, delay = 0, slide = 0, attack = 0.008, pan = 0, detune = 0 }) {
        const c = ac();
        if (!c || !enabled) return;
        const t0 = c.currentTime + delay;
        const osc = c.createOscillator();
        const gain = c.createGain();
        const p = panner(pan);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
        if (detune && osc.detune) osc.detune.value = detune;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain);
        gain.connect(p).connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
    }

    // ruído filtrado (explosões, cartas, whooshes)
    function noise({ dur = 0.2, vol = 0.12, delay = 0, filterFreq = 1200, filterType = "lowpass", pan = 0, slideTo = 0 }) {
        const c = ac();
        if (!c || !enabled) return;
        const t0 = c.currentTime + delay;
        const len = Math.floor(c.sampleRate * dur);
        const buffer = c.createBuffer(1, len, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        }
        const src = c.createBufferSource();
        src.buffer = buffer;
        const filter = c.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(filterFreq, t0);
        if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, slideTo), t0 + dur);
        const gain = c.createGain();
        const p = panner(pan);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        src.connect(filter).connect(gain);
        gain.connect(p).connect(master);
        src.start(t0);
    }

    // acorde rápido (várias notas quase juntas)
    function chord(freqs, { type = "triangle", dur = 0.3, vol = 0.1, delay = 0, spread = 0.03, pan = 0 } = {}) {
        freqs.forEach((f, i) =>
            tone({ freq: f, type, dur, vol, delay: delay + i * spread, pan })
        );
    }

    const sfx = {
        // ---------- GERAL ----------
        click() {
            tone({ freq: 700, type: "triangle", dur: 0.05, vol: 0.07 });
            tone({ freq: 1400, type: "sine", dur: 0.03, vol: 0.04, delay: 0.02 });
        },
        chip() { // ficha apostada — metálico em 3 camadas
            tone({ freq: 1800, type: "triangle", dur: 0.05, vol: 0.1 });
            tone({ freq: 2210, type: "triangle", dur: 0.05, vol: 0.08, delay: 0.045, detune: 8 });
            tone({ freq: 2600, type: "sine", dur: 0.04, vol: 0.05, delay: 0.09, pan: 0.2 });
        },
        stamp() { // aposta confirmada — "thunk" firme
            tone({ freq: 220, type: "sine", dur: 0.1, vol: 0.14, slide: -60 });
            noise({ dur: 0.06, vol: 0.06, filterFreq: 1800 });
        },
        win() {
            chord([523, 659, 784], { dur: 0.16, vol: 0.12, spread: 0.06 });
            chord([784, 988, 1175, 1568], { dur: 0.3, vol: 0.12, delay: 0.28, spread: 0.05 });
            tone({ freq: 2093, type: "sine", dur: 0.25, vol: 0.06, delay: 0.5, pan: 0.3 });
        },
        lose() {
            tone({ freq: 320, type: "sine", dur: 0.22, vol: 0.1, slide: -110 });
            tone({ freq: 240, type: "sine", dur: 0.3, vol: 0.08, delay: 0.16, slide: -90 });
        },
        push() {
            tone({ freq: 440, type: "sine", dur: 0.15, vol: 0.1 });
            tone({ freq: 440, type: "sine", dur: 0.15, vol: 0.08, delay: 0.12 });
        },
        error() {
            tone({ freq: 180, type: "square", dur: 0.09, vol: 0.07 });
            tone({ freq: 150, type: "square", dur: 0.12, vol: 0.07, delay: 0.11 });
        },
        notify() { // convite / pedido de amizade
            tone({ freq: 880, type: "sine", dur: 0.18, vol: 0.1 });
            tone({ freq: 1175, type: "sine", dur: 0.25, vol: 0.1, delay: 0.14 });
        },
        coinRain() { // payout grande — cascata de brilhos
            for (let i = 0; i < 8; i++) {
                tone({ freq: 1400 + Math.random() * 1200, type: "sine", dur: 0.12, vol: 0.05, delay: i * 0.06, pan: (i % 3 - 1) * 0.4 });
            }
        },

        // ---------- UI AUTOMÁTICA (v2.0) ----------
        clickNav() { // clique em botão — tick minimalista
            tone({ freq: 520, type: "sine", dur: 0.045, vol: 0.05 });
        },
        nav() { // navegar entre páginas — whoosh suave + pluck
            noise({ dur: 0.22, vol: 0.05, filterFreq: 600, slideTo: 3200, filterType: "bandpass" });
            tone({ freq: 660, type: "triangle", dur: 0.09, vol: 0.06, delay: 0.08 });
        },
        tabOut() { // saiu da aba
            tone({ freq: 520, type: "sine", dur: 0.14, vol: 0.06, slide: -180 });
        },
        tabIn() { // voltou pra aba
            tone({ freq: 380, type: "sine", dur: 0.14, vol: 0.06, slide: 160 });
            tone({ freq: 760, type: "sine", dur: 0.08, vol: 0.04, delay: 0.1 });
        },
        modalOpen() { // sessão/sala abrindo
            noise({ dur: 0.18, vol: 0.04, filterFreq: 500, slideTo: 2600, filterType: "bandpass" });
            chord([392, 523], { dur: 0.2, vol: 0.07, delay: 0.1 });
        },
        modalClose() { // sessão/sala fechando
            noise({ dur: 0.16, vol: 0.04, filterFreq: 2400, slideTo: 500, filterType: "bandpass" });
            tone({ freq: 440, type: "triangle", dur: 0.12, vol: 0.06, delay: 0.06 });
        },
        toggleOn() {
            tone({ freq: 700, type: "sine", dur: 0.07, vol: 0.07 });
            tone({ freq: 1050, type: "sine", dur: 0.09, vol: 0.06, delay: 0.06 });
        },
        toggleOff() {
            tone({ freq: 700, type: "sine", dur: 0.07, vol: 0.07 });
            tone({ freq: 480, type: "sine", dur: 0.09, vol: 0.06, delay: 0.06 });
        },
        hover() { // ultra-sutil, disponível pra uso manual
            tone({ freq: 2000, type: "sine", dur: 0.02, vol: 0.025 });
        },

        // ---------- JOGOS ----------
        dice() { // dado rolando — quicadas com pitch caindo
            for (let i = 0; i < 6; i++) {
                noise({ dur: 0.05, vol: 0.06 - i * 0.006, delay: i * 0.08, filterFreq: 2500 - i * 250 });
            }
        },
        coin() { // moeda no ar
            tone({ freq: 900, type: "square", dur: 0.08, vol: 0.06 });
            tone({ freq: 1200, type: "square", dur: 0.1, vol: 0.05, delay: 0.12 });
        },
        boom() {
            noise({ dur: 0.5, vol: 0.25, filterFreq: 400 });
            tone({ freq: 120, type: "sawtooth", dur: 0.4, vol: 0.13, slide: -80 });
            tone({ freq: 60, type: "sine", dur: 0.5, vol: 0.12, delay: 0.02 });
        },
        gem() { // célula segura no mines
            tone({ freq: 1300, type: "sine", dur: 0.12, vol: 0.1 });
            tone({ freq: 1600, type: "sine", dur: 0.1, vol: 0.08, delay: 0.08, pan: 0.25 });
        },
        rocket() { // crash subindo — whoosh contínuo
            noise({ dur: 0.8, vol: 0.04, filterFreq: 600, slideTo: 2200, filterType: "bandpass" });
        },
        cashout() {
            chord([784, 988, 1175], { dur: 0.15, vol: 0.11, spread: 0.07 });
            tone({ freq: 1568, type: "sine", dur: 0.2, vol: 0.07, delay: 0.24 });
        },
        card() { // carta distribuída
            noise({ dur: 0.08, vol: 0.09, filterFreq: 3000, filterType: "highpass" });
        },
        cardSpecial() { // carta especial!
            chord([660, 880, 1100, 1320], { type: "square", dur: 0.1, vol: 0.06, spread: 0.06 });
        },
        horse() { // cascos galopando
            for (let i = 0; i < 8; i++) {
                noise({ dur: 0.04, vol: 0.07, delay: i * 0.15, filterFreq: 500, pan: (i % 2 ? 0.3 : -0.3) });
            }
        },
        raceWin() {
            chord([523, 659, 784], { dur: 0.2, vol: 0.12, spread: 0.08 });
            chord([1047, 1319, 1568], { dur: 0.3, vol: 0.11, delay: 0.3, spread: 0.07 });
        },
        duelHit() {
            tone({ freq: 200, type: "square", dur: 0.12, vol: 0.12, slide: -80 });
            noise({ dur: 0.1, vol: 0.1, filterFreq: 800 });
        },
        spin() { // roleta girando
            for (let i = 0; i < 10; i++) {
                tone({ freq: 400 + i * 30, type: "triangle", dur: 0.05, vol: 0.05, delay: i * 0.1 });
            }
        },

        // ---------- SLOTS (v2.0) ----------
        spinSlots() { // alavanca puxada + rolos começando
            tone({ freq: 140, type: "square", dur: 0.08, vol: 0.12, slide: -40 });
            noise({ dur: 0.5, vol: 0.05, filterFreq: 1800, filterType: "bandpass", slideTo: 600 });
        },
        reelStop(i = 0) { // rolo parando — pitch desce a cada rolo
            tone({ freq: 320 - i * 40, type: "triangle", dur: 0.09, vol: 0.1, slide: -60 });
            noise({ dur: 0.05, vol: 0.05, filterFreq: 1500 });
        },
        jackpot() { // 7️⃣7️⃣7️⃣ — fanfarra completa
            chord([523, 659, 784], { dur: 0.18, vol: 0.13, spread: 0.05 });
            chord([659, 831, 988, 1319], { dur: 0.22, vol: 0.12, delay: 0.25, spread: 0.05 });
            chord([784, 1047, 1319, 1568, 2093], { dur: 0.5, vol: 0.13, delay: 0.55, spread: 0.06 });
            for (let i = 0; i < 6; i++) {
                tone({ freq: 1800 + Math.random() * 1400, type: "sine", dur: 0.15, vol: 0.05, delay: 0.7 + i * 0.08, pan: (i % 3 - 1) * 0.5 });
            }
        },
        cardDrop(rarity = "comum") { // carta ganha — escala pela raridade
            const seq = {
                comum:      [660],
                rara:       [660, 880],
                super_rara: [660, 880, 1100],
                epica:      [660, 880, 1100, 1320],
                lendaria:   [660, 880, 1100, 1320, 1760],
                cromatica:  [523, 659, 784, 1047, 1319, 1568, 2093],
            }[rarity] || [660];
            seq.forEach((f, i) =>
                tone({ freq: f, type: "sine", dur: 0.22, vol: 0.1, delay: i * 0.09, pan: (i % 2 ? 0.3 : -0.3) })
            );
            if (rarity === "cromatica" || rarity === "lendaria") {
                noise({ dur: 0.5, vol: 0.04, filterFreq: 4000, filterType: "highpass", delay: seq.length * 0.09 });
            }
        },

        // ---------- PROGRESSÃO ----------
        levelUp() {
            chord([523, 659, 784], { dur: 0.2, vol: 0.11, spread: 0.07 });
            chord([1047, 1319, 1568], { dur: 0.35, vol: 0.11, delay: 0.25, spread: 0.07 });
        },
        achievement() {
            chord([659, 831, 988, 1319], { type: "sine", dur: 0.25, vol: 0.11, spread: 0.1 });
        },
    };

    // ---------- AUTO-WIRE DE UI (v2.0) ----------
    // Efeitos globais sem tocar em nenhum outro arquivo:
    // cliques em botões/links, troca de aba, abertura do modal de sala.
    let lastUiSound = 0;
    function throttled(fn, ms = 70) {
        const now = Date.now();
        if (now - lastUiSound < ms) return;
        lastUiSound = now;
        fn();
    }

    document.addEventListener("DOMContentLoaded", () => {
        // botão de mute
        const btn = document.getElementById("sfxToggle");
        if (btn) {
            btn.textContent = enabled ? "🔊" : "🔇";
            btn.addEventListener("click", () => {
                const on = toggle();
                btn.textContent = on ? "🔊" : "🔇";
                if (on) sfx.toggleOn(); else sfx.toggleOff();
            });
        }

        // cliques globais: link interno → whoosh de navegação; botão → tick
        document.addEventListener("click", (e) => {
            const a = e.target.closest("a[href]");
            if (a) {
                const href = a.getAttribute("href") || "";
                if (!href || href.startsWith("#") || href.startsWith("javascript") || /^https?:/i.test(href)) return;
                throttled(() => sfx.nav(), 150);
                return;
            }
            const btnEl = e.target.closest("button");
            if (btnEl && btnEl.id !== "sfxToggle") {
                throttled(() => sfx.clickNav());
            }
        }, true);

        // troca de aba
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) sfx.tabOut();
            else sfx.tabIn();
        });

        // modal da sala abre/fecha (troca de sessão multiplayer)
        const modal = document.getElementById("roomModal");
        if (modal && "MutationObserver" in window) {
            let wasActive = modal.classList.contains("active");
            new MutationObserver(() => {
                const active = modal.classList.contains("active");
                if (active && !wasActive) sfx.modalOpen();
                if (!active && wasActive) sfx.modalClose();
                wasActive = active;
            }).observe(modal, { attributes: true, attributeFilter: ["class"] });
        }
    });

    function toggle() {
        enabled = !enabled;
        localStorage.setItem("arcadia_sfx", enabled ? "on" : "off");
        return enabled;
    }

    function isEnabled() {
        return enabled;
    }

    return { ...sfx, toggle, isEnabled };
})();
