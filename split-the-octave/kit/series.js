/* Split the Octave · shared series kit
   Exposes window.SO: pitch maths, a Web Audio engine with real-ish instruments and drums,
   a step sequencer, canvas helpers, a playable keyboard, a quiz helper, and the series chrome
   (header + volume, progress strip, "lesson done" stamp, next-lesson card).

   Usage in a lesson page:
     <link rel="stylesheet" href="../kit/series.css">
     <script src="../kit/series.js"></script>
     <script> SO.init('timbre'); ...lesson code... </script>
*/
(function(){
'use strict';

/* ---------------- the series ---------------- */
const LESSONS = [
  { slug: 'sound',        t: 'What is a sound?',  d: 'Vibration, pitch and loudness: the raw stuff music is made of.', h: 45 },
  { slug: 'timbre',       t: 'Tone colour',       d: 'Why a flute and a violin sound different playing the very same note.', h: 335 },
  { slug: 'notes',        t: 'Naming the notes',  d: 'A to G, the piano keyboard, and the octave: the same note, higher.', h: 195 },
  { slug: 'sharps-flats', t: 'Sharps & flats',    d: 'The black keys, half steps and whole steps, and why one key has two names.', h: 268 },
  { slug: 'rhythm',       t: 'Beat & rhythm',     d: 'The pulse, tempo, bars and patterns in time. Build your own beat.', h: 12 },
  { slug: 'intervals',    t: 'Intervals',         d: 'The distance between two notes, and why some pairs sound sweet and others clash.', h: 150 },
  { slug: 'major-minor',  t: 'Major & minor',     d: 'Bright and dark: how a scale’s pattern of steps gives music its mood.', h: 225 },
  { slug: 'chords',       t: 'Chords',            d: 'Stacking notes into chords, and the four-chord loop behind a thousand songs.', h: 300 },
  { slug: 'why-twelve',   t: 'Why twelve?',       d: 'The deep end: harmonics, the comma, and why the octave is split into 12 equal steps.', h: 31 },
];
const accent = (h, l = 74) => `hsl(${h} 85% ${l}%)`;

/* ---------------- tiny DOM helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const THUMB = new URLSearchParams(location.search).has('thumb');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- pitch maths ---------------- */
const C4 = 261.6256;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const ftom = f => 69 + 12 * Math.log2(f / 440);
const NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const FLATS = ['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
const mod12 = n => ((n % 12) + 12) % 12;
const octOf = m => Math.floor(m / 12) - 1;
const nameOf = (m, flats = false) => (flats ? FLATS : NAMES)[mod12(m)] + octOf(m);
const pcCol = (pc, l = 66, s = 80) => `hsl(${(mod12(pc) * 30 + 350) % 360} ${s}% ${l}%)`;
const BLACK = [1, 3, 6, 8, 10];
const isBlack = m => BLACK.includes(mod12(m));
function nearest(f){ const m = ftom(f), r = Math.round(m); return { m: r, off: (m - r) * 100, name: nameOf(r) }; }

/* ---------------- audio core ---------------- */
let ctx = null, master = null, bus = null, verbIn = null, noiseBuf = null, waves = {};
let vol = .7, muted = false, started = false;
const toneListeners = [];
const onTone = fn => toneListeners.push(fn);
const emit = (f, dur, inst) => toneListeners.forEach(fn => fn(f, dur, inst));

function mkWave(a, odd){
  const re = new Float32Array(a.length + 1), im = new Float32Array(a.length + 1);
  a.forEach((v, i) => im[i + 1] = v);
  return ctx.createPeriodicWave(re, im);
}
function ac(){
  if (!ctx){
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .003; comp.release.value = .22;
    master = ctx.createGain(); master.gain.value = 0;
    bus = ctx.createGain();
    // small generated room
    const sr = ctx.sampleRate, len = Math.floor(sr * 2.2), ir = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++){ const d = ir.getChannelData(ch); for (let i = 0; i < len; i++){ const x = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 3.2) * (i < sr * .008 ? i / (sr * .008) : 1); } }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    verbIn = ctx.createGain(); verbIn.gain.value = .16;
    const verbOut = ctx.createGain(); verbOut.gain.value = .55;
    bus.connect(comp); bus.connect(verbIn); verbIn.connect(conv); conv.connect(verbOut); verbOut.connect(comp);
    comp.connect(master); master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    waves.pluck = mkWave([1, .62, .4, .26, .18, .12, .08, .055, .035, .022, .014]);
    waves.organ = mkWave([1, .58, .42, .3, .22, .16, .11, .08]);
    waves.clar  = mkWave([1, .02, .55, .02, .32, .02, .2, .02, .12, .01, .07]);
    waves.reed  = mkWave([1, .9, .75, .6, .5, .42, .34, .27, .2, .15, .1, .07]);
  }
  if (ctx.state === 'suspended') ctx.resume();
  if (!started){ started = true; muted = false; applyVol(); }
  return ctx;
}
const now = () => ac().currentTime;
function applyVol(){
  const v = muted ? 0 : vol * vol;
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, .03);
  const b = $('#so-mute'); if (!b) return;
  const on = started && !muted && vol > 0;
  b.classList.toggle('off', !on);
  b.setAttribute('aria-label', on ? 'Sound on. Click to mute' : 'Sound off. Click to turn sound on');
  b.querySelector('.x').style.display = on ? 'none' : '';
  b.querySelector('.w1').style.display = on ? '' : 'none';
  b.querySelector('.w2').style.display = on ? '' : 'none';
  $('#so-volLab').textContent = on ? 'sound on' : 'sound off';
}
const loud = f => Math.min(1.3, Math.pow(262 / f, .22));
function out(pan = 0){
  const g = ctx.createGain();
  if (pan && ctx.createStereoPanner){ const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(bus); }
  else g.connect(bus);
  return g;
}
function noiseSrc(t, dur){ const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(t, Math.random()); s.stop(t + dur); return s; }
function osc(type, f, t, stop){
  const o = ctx.createOscillator();
  if (waves[type]) o.setPeriodicWave(waves[type]); else o.type = type;
  o.frequency.value = f; o.start(t); o.stop(stop); return o;
}
function vibrato(o, t, depthCents, rate = 5.5, delay = .25){
  const l = ctx.createOscillator(), g = ctx.createGain();
  l.frequency.value = rate; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.frequency.value * (Math.pow(2, depthCents / 1200) - 1), t + delay + .3);
  l.connect(g); g.connect(o.frequency); l.start(t); return l;
}

/* Karplus–Strong guitar string, rendered once per pitch */
const ksCache = new Map();
function ksBuffer(f, bright){
  const key = Math.round(f * 10) + ':' + bright;
  if (ksCache.has(key)) return ksCache.get(key);
  const sr = ctx.sampleRate, P = sr / f, N = Math.max(2, Math.round(P - .5)), len = Math.floor(sr * 3.2);
  const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < N; i++){ const r = Math.random() * 2 - 1; lp += (r - lp) * bright; d[i] = lp; }
  const decay = Math.min(.9995, .996 + (f < 200 ? .003 : 0));
  for (let i = N; i < len; i++) d[i] = decay * .5 * (d[i - N] + d[i - N - 1 < 0 ? 0 : i - N - 1]);
  const res = { b, rate: (N + .5) / P };
  ksCache.set(key, res); return res;
}

/* ---------------- instruments ----------------
   play(inst, freq, {t0 | at, dur, vel 0..1, pan, vis}) — returns the end time.
   inst: sine triangle square sawtooth pluck organ piano guitar flute clarinet violin trumpet voice marimba bell music-box */
const INSTRUMENTS = ['piano','guitar','flute','clarinet','violin','trumpet','voice','marimba','bell','music-box','organ','pluck','sine','triangle','square','sawtooth'];
function play(inst, f, o = {}){
  const c = ac();
  const t = o.at != null ? Math.max(o.at, c.currentTime) : c.currentTime + .03 + (o.t0 || 0);
  const dur = o.dur ?? 1, vel = o.vel ?? .8, L = loud(f) * (o.gain ?? 1);
  const g = out(o.pan || 0);
  let end = t + dur + .3;
  const env = (pk, a, rel) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.setValueAtTime(pk, t + Math.max(a, dur)); g.gain.setTargetAtTime(0, t + Math.max(a, dur), rel); end = t + Math.max(a, dur) + rel * 6; };
  switch (inst){
    case 'sine': case 'triangle': case 'square': case 'sawtooth': case 'organ': {
      const pk = .22 * L * vel * ({ square: .45, sawtooth: .5, triangle: .9, organ: .8 }[inst] || 1);
      env(pk, .015, .06); osc(inst, f, t, end).connect(g); break;
    }
    case 'pluck': {
      const pk = .24 * L * vel;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + .01);
      g.gain.setTargetAtTime(pk * .45, t + .015, .12); g.gain.setTargetAtTime(0, t + .2, Math.max(.08, (dur - .2) / 3));
      end = t + dur + .4; osc('pluck', f, t, end).connect(g); break;
    }
    case 'piano': {
      const B = .00035, life = Math.min(5, 1.4 + 2.6 * Math.pow(262 / f, .7)) * Math.max(.5, dur > .8 ? 1 : dur + .3);
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.Q.value = .4;
      lpf.frequency.setValueAtTime(Math.min(16000, f * (6 + 14 * vel)), t); lpf.frequency.setTargetAtTime(f * 3, t + .02, life * .35);
      lpf.connect(g);
      g.gain.setValueAtTime(.32 * L * (.35 + .65 * vel), t);
      const off = t + dur; g.gain.setTargetAtTime(0, off, .12);
      end = off + .8;
      for (let k = 1; k <= 9; k++){
        const fk = k * f * Math.sqrt(1 + B * k * k); if (fk > 15000) break;
        const pg = ctx.createGain(), a = Math.pow(k, -1.25) * (k === 1 ? 1 : .8);
        pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(a, t + .004);
        pg.gain.setTargetAtTime(a * .35, t + .006, .08 + life * .08 / k); pg.gain.setTargetAtTime(0, t + .1, life / (1 + .6 * k));
        const ok = osc('sine', fk * (1 + (Math.random() - .5) * .0006), t, end); ok.connect(pg); pg.connect(lpf);
      }
      const hn = ctx.createBiquadFilter(); hn.type = 'bandpass'; hn.frequency.value = Math.min(6000, f * 4); hn.Q.value = 1.2;
      const hg = ctx.createGain(); hg.gain.setValueAtTime(.12 * vel, t); hg.gain.exponentialRampToValueAtTime(.0001, t + .04);
      noiseSrc(t, .06).connect(hn); hn.connect(hg); hg.connect(lpf);
      break;
    }
    case 'guitar': {
      const { b, rate } = ksBuffer(f, .35 + .5 * vel);
      const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.Q.value = 1.4; body.gain.value = 6;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
      s.connect(body); body.connect(lp); lp.connect(g);
      g.gain.setValueAtTime(.5 * L * (.4 + .6 * vel), t); const off = t + Math.max(dur, .25); g.gain.setTargetAtTime(0, off, .09);
      end = Math.min(off + .7, t + 3.1); s.start(t); s.stop(end); break;
    }
    case 'flute': {
      const pk = .2 * L * vel;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk * 1.1, t + .09); g.gain.linearRampToValueAtTime(pk, t + .2);
      g.gain.setValueAtTime(pk, t + Math.max(.2, dur)); g.gain.setTargetAtTime(0, t + Math.max(.2, dur), .07); end = t + Math.max(.2, dur) + .5;
      const o1 = osc('sine', f, t, end), o2 = osc('sine', f * 2, t, end), o3 = osc('sine', f * 3, t, end);
      const g2 = ctx.createGain(); g2.gain.value = .18; const g3 = ctx.createGain(); g3.gain.value = .06;
      o1.connect(g); o2.connect(g2); g2.connect(g); o3.connect(g3); g3.connect(g);
      [o1, o2, o3].forEach((o, i) => vibrato(o, t, 9, 5.2, .3).stop(end));
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(.0, t); ng.gain.linearRampToValueAtTime(.25, t + .04); ng.gain.setTargetAtTime(.07, t + .06, .08);
      noiseSrc(t, end - t).connect(bp); bp.connect(ng); ng.connect(g); break;
    }
    case 'clarinet': {
      const pk = .22 * L * vel; env(pk, .045, .06);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 9); lp.Q.value = .7; lp.connect(g);
      const o = osc('clar', f, t, end); o.connect(lp); vibrato(o, t, 3, 4.8, .5).stop(end); break;
    }
    case 'violin': {
      const pk = .2 * L * vel;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + .14); g.gain.setValueAtTime(pk, t + Math.max(.14, dur)); g.gain.setTargetAtTime(0, t + Math.max(.14, dur), .1);
      end = t + Math.max(.14, dur) + .7;
      const o = osc('sawtooth', f, t, end), o2 = osc('sawtooth', f * 1.003, t, end);
      vibrato(o, t, 18, 5.6, .35).stop(end); vibrato(o2, t, 18, 5.6, .35).stop(end);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = .5;
      const p1 = ctx.createBiquadFilter(); p1.type = 'peaking'; p1.frequency.value = 280; p1.Q.value = 2; p1.gain.value = 8;
      const p2 = ctx.createBiquadFilter(); p2.type = 'peaking'; p2.frequency.value = 2900; p2.Q.value = 1.5; p2.gain.value = 7;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
      const mix = ctx.createGain(); mix.gain.value = .5; o.connect(mix); o2.connect(mix);
      mix.connect(hp); hp.connect(p1); p1.connect(p2); p2.connect(lp); lp.connect(g);
      const bn = ctx.createBiquadFilter(); bn.type = 'highpass'; bn.frequency.value = 3000; const bg = ctx.createGain(); bg.gain.value = .015;
      noiseSrc(t, end - t).connect(bn); bn.connect(bg); bg.connect(g); break;
    }
    case 'trumpet': {
      const pk = .2 * L * vel;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + .03); g.gain.setValueAtTime(pk, t + Math.max(.05, dur)); g.gain.setTargetAtTime(0, t + Math.max(.05, dur), .05);
      end = t + Math.max(.05, dur) + .4;
      const o = osc('sawtooth', f, t, end); o.frequency.setValueAtTime(f * .97, t); o.frequency.exponentialRampToValueAtTime(f, t + .05);
      vibrato(o, t, 7, 5.5, .4).stop(end);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
      lp.frequency.setValueAtTime(f * 1.5, t); lp.frequency.linearRampToValueAtTime(Math.min(9000, f * (4 + 6 * vel)), t + .06); lp.frequency.setTargetAtTime(f * (3 + 3 * vel), t + .1, .3);
      const pk2 = ctx.createBiquadFilter(); pk2.type = 'peaking'; pk2.frequency.value = 1300; pk2.Q.value = 1; pk2.gain.value = 6;
      o.connect(lp); lp.connect(pk2); pk2.connect(g); break;
    }
    case 'voice': {
      const pk = .5 * L * vel;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + .12); g.gain.setValueAtTime(pk, t + Math.max(.12, dur)); g.gain.setTargetAtTime(0, t + Math.max(.12, dur), .09);
      end = t + Math.max(.12, dur) + .6;
      const o = osc('sawtooth', f, t, end); vibrato(o, t, 20, 5.2, .45).stop(end);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; o.connect(lp);
      [[730, 1, 9], [1090, .5, 10], [2440, .25, 12]].forEach(([fr, a, q]) => {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
        const fg = ctx.createGain(); fg.gain.value = a; lp.connect(bp); bp.connect(fg); fg.connect(g);
      });
      break;
    }
    case 'marimba': case 'bell': case 'music-box': {
      const P = { marimba: [[1, 1, .9], [3.99, .3, .2], [10.1, .1, .05]],
                  bell: [[.56, .5, 3], [.92, .4, 2.6], [1.19, .6, 2.2], [1.71, .3, 1.6], [2, .5, 1.4], [2.74, .2, 1], [3, .25, .9], [3.76, .1, .6], [4.07, .1, .5]],
                  'music-box': [[1, 1, 1.4], [5.4, .25, .3], [8.9, .1, .12]] }[inst];
      const pkAll = (inst === 'bell' ? .14 : .26) * L * vel;
      g.gain.value = pkAll; let longest = 0;
      P.forEach(([r, a, tau]) => {
        const fk = f * r; if (fk > 16000) return;
        const tt = tau * (inst === 'marimba' ? Math.pow(262 / f, .5) : 1) * (inst === 'bell' ? 1.6 : 1);
        const pg = ctx.createGain(); pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(a, t + .002); pg.gain.setTargetAtTime(0, t + .003, tt);
        osc('sine', fk, t, t + tt * 6 + .1).connect(pg); pg.connect(g); longest = Math.max(longest, tt * 6);
      });
      end = t + longest + .1; break;
    }
    default: return play('pluck', f, o);
  }
  if (o.vis !== false) setTimeout(() => emit(f, dur, inst), Math.max(0, (t - c.currentTime) * 1000));
  return end;
}
/* the original page's API, kept so code can be shared */
function note(f, t0 = 0, dur = 1, o = {}){ return play(o.timbre || 'pluck', f, { t0, dur, vel: (o.gain ?? .2) / .2 * .8, vis: o.vis, at: o.at, pan: o.pan }); }

/* ---------------- drums ---------------- */
function drum(name, o = {}){
  const c = ac(), t = o.at != null ? Math.max(o.at, c.currentTime) : c.currentTime + .02 + (o.t0 || 0), v = o.vel ?? .9;
  const g = out(o.pan || 0);
  switch (name){
    case 'kick': {
      const s = osc('sine', 150, t, t + .5); s.frequency.setValueAtTime(160, t); s.frequency.exponentialRampToValueAtTime(42, t + .14);
      g.gain.setValueAtTime(.95 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .42); s.connect(g);
      const cl = ctx.createGain(); cl.gain.setValueAtTime(.25 * v, t); cl.gain.exponentialRampToValueAtTime(.001, t + .012);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; noiseSrc(t, .02).connect(hp); hp.connect(cl); cl.connect(g); break;
    }
    case 'snare': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(.55 * v, t); ng.gain.exponentialRampToValueAtTime(.001, t + .2);
      noiseSrc(t, .25).connect(hp); hp.connect(ng); ng.connect(g);
      const s = osc('triangle', 190, t, t + .2); s.frequency.exponentialRampToValueAtTime(150, t + .1);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(.45 * v, t); sg.gain.exponentialRampToValueAtTime(.001, t + .12); s.connect(sg); sg.connect(g); break;
    }
    case 'hat': case 'openhat': {
      const len = name === 'hat' ? .05 : .35;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
      const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 10000; bp.gain.value = 6;
      g.gain.setValueAtTime(.3 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + len);
      noiseSrc(t, len + .05).connect(hp); hp.connect(bp); bp.connect(g); break;
    }
    case 'clap': {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2; bp.connect(g);
      g.gain.setValueAtTime(0, t);
      [0, .011, .022].forEach(d => { g.gain.setValueAtTime(.6 * v, t + d); g.gain.exponentialRampToValueAtTime(.05, t + d + .01); });
      g.gain.setValueAtTime(.4 * v, t + .033); g.gain.exponentialRampToValueAtTime(.001, t + .22);
      noiseSrc(t, .25).connect(bp); break;
    }
    case 'tom': {
      const f = o.f || 120; const s = osc('sine', f * 1.4, t, t + .5); s.frequency.exponentialRampToValueAtTime(f, t + .08);
      g.gain.setValueAtTime(.7 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + .4); s.connect(g); break;
    }
    case 'block': case 'click': {
      const f = name === 'click' ? (o.accent ? 1760 : 1100) : (o.f || 900);
      const s = osc('sine', f, t, t + .08); const s2 = osc('sine', f * 2.7, t, t + .03);
      g.gain.setValueAtTime(.45 * v, t); g.gain.exponentialRampToValueAtTime(.001, t + (name === 'click' ? .04 : .07));
      const g2 = ctx.createGain(); g2.gain.value = .3; s.connect(g); s2.connect(g2); g2.connect(g); break;
    }
    case 'shaker': {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6000; bp.Q.value = .8;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.22 * v, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .09);
      noiseSrc(t, .1).connect(bp); bp.connect(g); break;
    }
  }
  return t;
}

/* ---------------- sustained tones (one at a time across the page) ---------------- */
let current = null;
function drone(freqs, timbre = 'organ', gain = .15, owner = null){
  stopDrone();
  const c = ac(), o = c.createGain();
  o.gain.setValueAtTime(0, c.currentTime); o.gain.linearRampToValueAtTime(1, c.currentTime + .08); o.connect(bus);
  const vs = freqs.map(f => {
    const x = c.createOscillator(), g = c.createGain();
    if (waves[timbre]) x.setPeriodicWave(waves[timbre]); else x.type = timbre;
    x.frequency.value = f; g.gain.value = gain * loud(f); x.connect(g); g.connect(o); x.start();
    return { o: x, g };
  });
  const d = {
    vs, owner, out: o,
    set(i, f){ vs[i].o.frequency.setTargetAtTime(f, c.currentTime, .025); },
    gain(i, v){ vs[i].g.gain.setTargetAtTime(v, c.currentTime, .03); },
    stop(){
      if (d.dead) return; d.dead = true;
      o.gain.setTargetAtTime(0, c.currentTime, .05); vs.forEach(v => v.o.stop(c.currentTime + .4));
      if (owner && owner.onStop) owner.onStop();
    }
  };
  current = d; return d;
}
function stopDrone(){ if (current){ const d = current; current = null; d.stop(); } }
const isOwner = o => current && !current.dead && current.owner === o;
function setPlayBtn(b, playing, a = 'Play', s = 'Stop'){
  b.innerHTML = playing ? `<span style="width:10px;height:10px;background:currentColor;border-radius:2px"></span> ${s}` : `<span class="pl"></span> ${a}`;
  b.setAttribute('aria-pressed', playing ? 'true' : 'false');
}

/* ---------------- step sequencer ----------------
   const s = SO.seq({ bpm: 100, steps: 16, sub: 4, onStep(i, time, dt){ ... } });
   s.start(); s.stop(); s.bpm = 120; s.playing
   onStep is called slightly ahead of time with the exact audio time; use SO.at(time, fn) for visuals. */
const seqs = [];
function seq({ bpm = 100, steps = 16, sub = 4, swing = 0, onStep, onStop } = {}){
  let timer = 0, next = 0, i = 0;
  const s = { bpm, steps, sub, swing, playing: false, step: -1,
    start(){
      if (s.playing) return; seqs.forEach(o => o !== s && o.playing && o.stop());
      stopDrone(); ac(); s.playing = true; i = 0; next = ctx.currentTime + .08;
      const tick = () => {
        while (s.playing && next < ctx.currentTime + .12){
          const dt = 60 / s.bpm / s.sub;
          const sw = (i % 2 === 1) ? s.swing * dt * .5 : 0;
          const idx = i % s.steps; s.step = idx;
          onStep && onStep(idx, next + sw, dt);
          next += dt; i++;
        }
        if (s.playing) timer = setTimeout(tick, 25);
      };
      tick();
    },
    stop(){ if (!s.playing) return; s.playing = false; clearTimeout(timer); s.step = -1; onStop && onStop(); },
    toggle(){ s.playing ? s.stop() : s.start(); return s.playing; }
  };
  seqs.push(s); return s;
}
function stopAll(){ stopDrone(); seqs.forEach(s => s.stop()); }
/* run a visual callback when the audio clock reaches `time` */
function at(time, fn){ const d = (time - (ctx ? ctx.currentTime : 0)) * 1000; setTimeout(fn, Math.max(0, d)); }

/* ---------------- canvas helpers ---------------- */
function fit(cv){
  const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
  const x = cv.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0);
  return [x, r.width, r.height];
}
const drawers = [];
const io = new IntersectionObserver(es => es.forEach(e => e.target._vis = e.isIntersecting), { rootMargin: '120px' });
function addDrawer(cv, fn){ cv._vis = false; io.observe(cv); drawers.push({ cv, fn }); }
let looping = false;
function loop(t){ for (const d of drawers) if ((d.cv._vis || THUMB) && d.cv.clientWidth > 1) d.fn(t / 1000); requestAnimationFrame(loop); }
function startLoop(){ if (!looping){ looping = true; requestAnimationFrame(loop); } }

/* ---------------- keyboard ----------------
   SO.keys(host, { lo:60, hi:84, inst:'piano', keymap:false, labels:'all'|'white'|'c'|'none', onPress(m), kbLabels:[...], dur:1.2 })
   returns { el, mark(midis, cls='in'), light(m, ms), setInst(name), press(m) } */
function keys(host, opt = {}){
  const { lo = 60, hi = 84, keymap = false, onPress = null, kbLabels = null, labels = 'all', dur = 1.2, colour = true } = opt;
  let inst = opt.inst || 'piano';
  const box = document.createElement('div'); box.className = 'keys'; host.classList.add('kscroll');
  if (opt.height) box.style.height = opt.height + 'px';
  let whites = 0; for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++;
  box.style.minWidth = Math.min(whites * 27, 600) + 'px';
  const ks = {}; let wi = 0;
  for (let m = lo; m <= hi; m++){
    const pc = mod12(m), black = isBlack(m);
    const k = document.createElement('div');
    k.className = black ? 'b' : 'w'; k.style.setProperty('--c', colour ? pcCol(pc) : 'var(--hot)'); k.dataset.m = m;
    let lab = '';
    if (labels === 'all') lab = black ? NAMES[pc] : NAMES[pc] + (pc === 0 ? octOf(m) : '');
    else if (labels === 'white') lab = black ? '' : NAMES[pc];
    else if (labels === 'c') lab = pc === 0 ? 'C' + octOf(m) : '';
    const kb = kbLabels && kbLabels[m - lo] ? `<span class="kb">${kbLabels[m - lo]}</span>` : '';
    k.innerHTML = `${kb}${colour ? '<span class="dot"></span>' : ''}<span class="lbl">${lab}</span>`;
    if (black){ const bw = 100 / whites * .62; k.style.width = bw + '%'; k.style.left = (wi * 100 / whites - bw / 2) + '%'; }
    else wi++;
    k.addEventListener('pointerdown', e => { e.preventDefault(); press(m); });
    k.addEventListener('pointerenter', e => { if (e.buttons & 1 && e.pointerType === 'mouse') press(m); });
    ks[m] = k; box.appendChild(k);
  }
  host.appendChild(box);
  function press(m){ play(inst, mtof(m), { dur }); onPress && onPress(m); }
  const timers = {};
  function light(m, ms = 400){ const k = ks[m]; if (!k) return; k.classList.add('lit'); clearTimeout(timers[m]); timers[m] = setTimeout(() => k.classList.remove('lit'), ms); }
  onTone((f, d) => { const n = nearest(f); if (ks[n.m] && Math.abs(n.off) < 30) light(n.m, Math.max(250, d * 600)); });
  if (keymap){
    const map = 'awsedftgyhujkolp;'.split('');
    document.addEventListener('keydown', e => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const i = map.indexOf(e.key.toLowerCase()); if (i < 0 || lo + i > hi) return;
      const r = box.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      press(lo + i);
    });
  }
  return { el: box, keys: ks, press, light,
    mark(ms, cls = 'in'){ Object.entries(ks).forEach(([m, k]) => k.classList.toggle(cls, ms.includes(+m))); },
    setInst(n){ inst = n; } };
}

/* ---------------- quiz helper ----------------
   SO.quiz(host, { make(){ return { prompt, play(), options:['a','b'], answer: 1, explain: 'html' } }, newLabel })
   builds: prompt, [Hear it again] [New question], option buttons, message and score. */
function quiz(host, { make, newLabel = 'New question', againLabel = 'Hear it again', intro = 'Press <b>' } = {}){
  host.classList.add('sq');
  host.innerHTML = `<p class="qprompt"></p><div class="row"><button class="btn go sm" data-a="new"><span class="pl"></span> ${newLabel}</button><button class="btn sm" data-a="again">${againLabel}</button></div><div class="qopts"></div><div class="qmsg"></div><div class="qbar"><span class="score">0 / 0</span><span class="streak"></span></div>`;
  const P = host.querySelector('.qprompt'), O = host.querySelector('.qopts'), M = host.querySelector('.qmsg');
  let q = null, right = 0, total = 0, streak = 0;
  P.innerHTML = `Press <b>${newLabel}</b> to start.`;
  function next(){
    stopAll(); q = make(); q.done = false;
    P.innerHTML = q.prompt; M.innerHTML = '';
    O.innerHTML = q.options.map((t, i) => `<button data-i="${i}">${t}</button>`).join('');
    q.play && q.play();
  }
  host.querySelector('[data-a=new]').addEventListener('click', next);
  host.querySelector('[data-a=again]').addEventListener('click', () => { if (q && q.play){ stopAll(); q.play(); } else next(); });
  O.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b || !q || q.done) return;
    q.done = true; total++; const i = +b.dataset.i;
    [...O.children].forEach(x => { x.disabled = true; if (+x.dataset.i === q.answer) x.classList.add('right'); });
    if (i === q.answer){ right++; streak++; M.innerHTML = `<b style="color:var(--ok)">Yes!</b> ${q.explain || ''}`; }
    else { streak = 0; b.classList.add('wrong'); M.innerHTML = `Not quite. ${q.explain || ''}`; }
    host.querySelector('.score').textContent = `${right} / ${total} correct`;
    host.querySelector('.streak').textContent = streak >= 3 ? `${streak} in a row` : '';
    q.after && q.after(i === q.answer);
  });
  return { next };
}

/* ---------------- progress ---------------- */
const KEY = 'so-series-done';
const getDone = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e){ return new Set(); } };
function markDone(slug){ try { const s = getDone(); s.add(slug); localStorage.setItem(KEY, JSON.stringify([...s])); } catch (e){} }

/* ---------------- series chrome ---------------- */
const SPK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path class="w1" d="M16.5 8.5a5 5 0 0 1 0 7"/><path class="w2" d="M19 6a8.5 8.5 0 0 1 0 12"/><path class="x" d="M16 9l6 6M22 9l-6 6" style="display:none"/></svg>`;
function header(backHref, backText){
  const h = document.createElement('header'); h.className = 'gut';
  h.innerHTML = `<a class="back" href="${backHref}">&larr; ${backText}</a>
  <div class="vol" role="group" aria-label="Volume"><button id="so-mute" class="off" aria-label="Sound off. Click to turn sound on" title="Sound on/off">${SPK}</button>
  <input id="so-volume" type="range" min="0" max="100" value="70" aria-label="Volume"><span class="lab" id="so-volLab">sound off</span></div>`;
  document.body.prepend(h);
  $('#so-volume').addEventListener('input', e => { vol = e.target.value / 100; if (vol > 0) muted = false; ac(); applyVol(); });
  $('#so-mute').addEventListener('click', () => { if (!started){ ac(); hello(); return; } muted = !muted; applyVol(); });
  applyVol();
}
function hello(){ [0, 4, 7, 12, 16].forEach((s, i) => play('piano', mtof(60 + s), { t0: i * .12, dur: 1.4, vel: .55 })); }

function strip(host, slug){
  const done = getDone();
  host.classList.add('series-strip');
  host.innerHTML = LESSONS.map((L, i) => `<a href="../${L.slug}/" style="--c:${accent(L.h)}" data-t="${i + 1}. ${L.t}" class="${L.slug === slug ? 'here' : ''} ${done.has(L.slug) ? 'done' : ''}" aria-label="Lesson ${i + 1}: ${L.t}"></a>`).join('');
}
function endcap(slug){
  const i = LESSONS.findIndex(L => L.slug === slug), L = LESSONS[i], nx = LESSONS[i + 1], pv = LESSONS[i - 1];
  const e = document.createElement('section'); e.className = 'endcap gut';
  e.innerHTML = `<div class="stamp" id="so-stamp"><i>✓</i> Lesson ${i + 1} done</div>
    ${nx ? `<a class="nextcard" href="../${nx.slug}/" style="--c:${accent(nx.h)}"><span><span class="k">Next · lesson ${i + 2} of ${LESSONS.length}</span><span class="t">${nx.t}</span><span class="d">${nx.d}</span></span><span class="arr">&rarr;</span></a>`
         : `<a class="nextcard" href="../" style="--c:${accent(L.h)}"><span><span class="k">You finished the series</span><span class="t">Back to all lessons</span><span class="d">Revisit any lesson, or go play the xylophone in Things to touch.</span></span><span class="arr">&rarr;</span></a>`}
    <div class="row" style="justify-content:space-between">${pv ? `<a class="prevlink" href="../${pv.slug}/">&larr; ${i}. ${pv.t}</a>` : '<span></span>'}<a class="prevlink" href="../">all lessons</a></div>`;
  const main = $('main'); main.after(e);
  const f = document.createElement('footer'); f.className = 'gut';
  f.innerHTML = `<span>made by nelu radpour · florida state university</span><span>all sound is synthesised live in your browser</span>`;
  e.after(f);
  const ob = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting){ $('#so-stamp').classList.add('on'); markDone(slug); ob.disconnect(); } }), { threshold: .6 });
  ob.observe($('#so-stamp'));
}

/* SO.init(slug): sets the lesson accent, adds header, strip (into #so-strip if present), endcap, starts the draw loop */
function init(slug){
  const i = LESSONS.findIndex(L => L.slug === slug);
  if (THUMB) document.body.classList.add('thumb');
  if (i >= 0){
    document.documentElement.style.setProperty('--hot', accent(LESSONS[i].h));
    document.documentElement.style.setProperty('--hue', LESSONS[i].h);
  }
  header('../', 'Split the Octave');
  const s = $('#so-strip'); if (s && i >= 0) strip(s, slug);
  const kick = $('#so-kicker'); if (kick && i >= 0) kick.innerHTML = `<i>${i + 1}</i> Lesson ${i + 1} of ${LESSONS.length}`;
  if (i >= 0 && $('main')) endcap(slug);
  const h = $('#hello'); if (h) h.addEventListener('click', hello);
  startLoop();
  // let a first tap anywhere wake the audio (iOS)
  const wake = () => { if (ctx && ctx.state === 'suspended') ctx.resume(); };
  addEventListener('pointerdown', wake, { passive: true });
}

window.SO = { LESSONS, accent, $, $$, THUMB, RM,
  C4, mtof, ftom, NAMES, FLATS, mod12, octOf, nameOf, pcCol, BLACK, isBlack, nearest,
  ac, now, play, note, drum, drone, stopDrone, stopAll, isOwner, setPlayBtn, seq, at, onTone, emit, INSTRUMENTS,
  fit, addDrawer, startLoop, keys, quiz, getDone, markDone, header, strip, hello, init,
  get ctx(){ return ctx; }, get bus(){ return bus; } };
})();
