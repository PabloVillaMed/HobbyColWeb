/* GlowApp — interaction sounds.
   Every sound is synthesised with the Web Audio API rather than loaded from a
   file: the app has to work from the offline cache, and a handful of short
   tones cost nothing to generate and keep the bundle at zero assets.
   The palette is deliberately soft — these should feel like a confirmation,
   not an alarm. */
(function (global) {
  'use strict';

  let context = null;
  let enabled = true;

  function ensureContext() {
    if (context) return context;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch (err) {
      return null;
    }
    return context;
  }

  /* Browsers start the audio clock suspended until a gesture; every play path
     nudges it, which is harmless once it is already running. */
  function resume() {
    const ctx = ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /**
   * One shaped sine/triangle blip.
   * `slide` bends the pitch over the life of the note, which is what makes a
   * drop sound like a drop rather than a beep.
   */
  function tone(opts) {
    const ctx = resume();
    if (!ctx || !enabled) return;

    const now = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.from, now);
    if (opts.to && opts.to !== opts.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), now + opts.duration);
    }

    // A short attack and an exponential tail: no clicks at either end.
    const peak = opts.gain === undefined ? 0.12 : opts.gain;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + opts.duration + 0.02);
  }

  const SOUNDS = {
    /* A water drop: a fast downward bend with a little resonance under it. */
    drop: () => {
      tone({ from: 880, to: 220, duration: 0.16, type: 'sine', gain: 0.16 });
      tone({ from: 320, to: 180, duration: 0.10, type: 'sine', gain: 0.07, delay: 0.02 });
    },
    /* Counting up anything that is not water — a soft wooden tick. */
    tick: () => tone({ from: 620, to: 520, duration: 0.07, type: 'triangle', gain: 0.09 }),
    /* Taking one back. Lower and shorter, so it reads as an undo. */
    undo: () => tone({ from: 420, to: 300, duration: 0.09, type: 'sine', gain: 0.07 }),
    /* A habit completed: a clean rising third. */
    complete: () => {
      tone({ from: 660, to: 660, duration: 0.11, type: 'sine', gain: 0.11 });
      tone({ from: 880, to: 880, duration: 0.16, type: 'sine', gain: 0.10, delay: 0.06 });
    },
    /* Unticking a habit. */
    uncomplete: () => tone({ from: 480, to: 330, duration: 0.12, type: 'sine', gain: 0.08 }),
    /* The whole day done: a short major arpeggio, the only flourish here. */
    celebrate: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
        tone({ from: hz, to: hz, duration: 0.22, type: 'sine', gain: 0.10, delay: i * 0.075 });
      });
    },
    /* Mood recorded — soft and neutral, no judgement in the tone. */
    mood: () => tone({ from: 540, to: 720, duration: 0.14, type: 'sine', gain: 0.08 }),
    /* Picking a habit up to drag it. */
    lift: () => tone({ from: 300, to: 420, duration: 0.07, type: 'triangle', gain: 0.06 }),
  };

  function play(name) {
    if (!enabled) return;
    const sound = SOUNDS[name];
    if (sound) {
      try {
        sound();
      } catch (err) {
        /* An audio failure must never interrupt logging a habit. */
      }
    }
  }

  global.Sounds = {
    play: play,
    setEnabled: (value) => { enabled = !!value; },
    isEnabled: () => enabled,
    unlock: resume,
  };
})(window);
