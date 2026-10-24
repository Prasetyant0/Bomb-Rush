// sfx.js — one shared AudioContext + lazily-created Audio loop players for the
// generated assets in assets/music (README.txt: bomb_sfx, handoff_sfx, victory_fanfare,
// arcade_chase, panic_stinger). No frameworks: <audio>-equivalent via HTMLAudioElement
// would fight polish; WebAudio decode is tiny and keeps gain under our control.
const BASE = "../assets/music/"; // relative to src/game/

export function SFX(initial) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  let on = !!initial?.on;
  const buffers = new Map();
  const music = { node: null, name: null };
  const alarm = { osc: null };

  async function buffer(name) {
    if (buffers.has(name)) return buffers.get(name);
    const p = fetch(new URL("../assets/music/" + name + ".mp3", import.meta.url))
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b));
    buffers.set(name, p); // cache the promise — parallel callers await the same decode
    p.catch(() => buffers.delete(name)); // a bad asset can be retried later
    return p;
  }
  function play(name, { gain = 1, loop = false, stop = null } = {}) {
    if (!on) return;
    buffer(name).then((b) => {
      const src = ctx.createBufferSource();
      src.buffer = b; src.loop = loop;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(g).connect(master);
      src.start();
      if (stop) { stop.src = src; stop.gain = g; }
    }).catch(() => {}); // missing/corrupt asset in a demo must never break the loop
  }
  return {
    get on() { return on; },
    set on(v) { on = v; master.gain.value = v ? 0.5 : 0; if (!v) stopAlarm(), stopMusic(); },
    play(name, opts) { play(name, opts); },
    music(name) { // one music bed at a time
      if (music.name === name) return;
      stopMusic();
      if (!on) { music.name = name; return; } // remember, will start on unmute — lazily via next call
      music.name = name;
      const stop = {};
      play(name, { gain: 0.22, loop: true, stop });
      music.node = stop;
    },
    alarm() { // last-3-seconds tick (panic_stinger is 10 s; a soft tick keeps it snappy)
      if (!on || alarm.osc) return;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "triangle"; osc.frequency.value = 1320;
      g.gain.value = 0.05;
      osc.connect(g).connect(master);
      osc.start();
      alarm.osc = { osc, g };
      osc.stop(ctx.currentTime + 0.09);
      osc.onended = () => (alarm.osc = null);
    },
    stopAlarm: () => {},
  };
  function stopMusic() { if (music.node) { try { music.node.src.stop(); } catch {} music.node = null; music.name = null; } }
}
