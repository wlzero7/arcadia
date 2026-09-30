// ========================================
// ARCADIA SFX — motor de sons (WebAudio, zero arquivos)
// v0.9.1
// ========================================

const Sfx = (() => {

    let ctx = null;
    let enabled = localStorage.getItem("arcadia_sfx") !== "off";

    function ac() {
        if (!ctx) {
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (_) {
                return null;
            }
        }
        // browsers exigem gesto do usuário antes de tocar
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
    }

    // tom simples com envelope
    function tone({ freq = 440, type = "sine", dur = 0.15, vol = 0.15, delay = 0, slide = 0 }) {
        const c = ac();
        if (!c || !enabled) return;
        const t0 = c.currentTime + delay;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain).connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    // ruído (para explosões, cartas, fichas)
    function noise({ dur = 0.2, vol = 0.12, delay = 0, filterFreq = 1200 }) {
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
        filter.type = "lowpass";
        filter.frequency.value = filterFreq;
        const gain = c.createGain();
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        src.connect(filter).connect(c.destination);
        src.start(t0);
    }

    const sfx = {
        // ---------- GERAL ----------
        click() {
            tone({ freq: 600, type: "triangle", dur: 0.06, vol: 0.08 });
        },
        chip() { // ficha apostada
            tone({ freq: 1800, type: "triangle", dur: 0.05, vol: 0.1 });
            tone({ freq: 2200, type: "triangle", dur: 0.05, vol: 0.08, delay: 0.05 });
        },
        win() {
            [523, 659, 784, 1047].forEach((f, i) =>
                tone({ freq: f, type: "triangle", dur: 0.18, vol: 0.14, delay: i * 0.09 })
            );
        },
        lose() {
            tone({ freq: 300, type: "sawtooth", dur: 0.25, vol: 0.1, slide: -150 });
            tone({ freq: 200, type: "sawtooth", dur: 0.3, vol: 0.08, delay: 0.15, slide: -100 });
        },
        push() {
            tone({ freq: 440, type: "sine", dur: 0.15, vol: 0.1 });
            tone({ freq: 440, type: "sine", dur: 0.15, vol: 0.08, delay: 0.12 });
        },

        // ---------- JOGOS ----------
        dice() { // dado rolando
            for (let i = 0; i < 6; i++) {
                noise({ dur: 0.05, vol: 0.06, delay: i * 0.08, filterFreq: 2500 });
            }
        },
        coin() { // moeda no ar
            tone({ freq: 900, type: "square", dur: 0.08, vol: 0.06 });
            tone({ freq: 1200, type: "square", dur: 0.1, vol: 0.05, delay: 0.12 });
        },
        boom() {
            noise({ dur: 0.5, vol: 0.25, filterFreq: 400 });
            tone({ freq: 120, type: "sawtooth", dur: 0.4, vol: 0.15, slide: -80 });
        },
        gem() { // célula segura no mines
            tone({ freq: 1300, type: "sine", dur: 0.12, vol: 0.1 });
            tone({ freq: 1600, type: "sine", dur: 0.1, vol: 0.08, delay: 0.08 });
        },
        rocket() { // crash subindo
            noise({ dur: 0.8, vol: 0.04, filterFreq: 900 });
        },
        cashout() {
            [784, 988, 1175].forEach((f, i) =>
                tone({ freq: f, type: "triangle", dur: 0.15, vol: 0.12, delay: i * 0.07 })
            );
        },
        card() { // carta distribuída
            noise({ dur: 0.08, vol: 0.09, filterFreq: 3000 });
        },
        cardSpecial() { // carta especial!
            [660, 880, 1100, 1320].forEach((f, i) =>
                tone({ freq: f, type: "square", dur: 0.1, vol: 0.07, delay: i * 0.06 })
            );
        },
        horse() { // cascos galopando
            for (let i = 0; i < 8; i++) {
                noise({ dur: 0.04, vol: 0.07, delay: i * 0.15, filterFreq: 500 });
            }
        },
        raceWin() {
            [523, 659, 784, 1047, 1319].forEach((f, i) =>
                tone({ freq: f, type: "triangle", dur: 0.2, vol: 0.13, delay: i * 0.1 })
            );
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
        levelUp() {
            [523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
                tone({ freq: f, type: "triangle", dur: 0.22, vol: 0.12, delay: i * 0.08 })
            );
        },
        achievement() {
            [659, 831, 988, 1319].forEach((f, i) =>
                tone({ freq: f, type: "sine", dur: 0.25, vol: 0.12, delay: i * 0.1 })
            );
        },
        clickNav() {
            tone({ freq: 500, type: "sine", dur: 0.05, vol: 0.06 });
        },
    };

    function toggle() {
        enabled = !enabled;
        localStorage.setItem("arcadia_sfx", enabled ? "on" : "off");
        return enabled;
    }

    function isEnabled() {
        return enabled;
    }

    // auto-wire do botão de mute
    document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("sfxToggle");
        if (!btn) return;
        btn.textContent = enabled ? "🔊" : "🔇";
        btn.addEventListener("click", () => {
            const on = toggle();
            btn.textContent = on ? "🔊" : "🔇";
            if (on) sfx.click();
        });
    });

    return { ...sfx, toggle, isEnabled };
})();
