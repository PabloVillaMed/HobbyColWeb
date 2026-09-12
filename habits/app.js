/* Hábitos — habit, exercise and mood tracker.
   Local-first: the whole state lives in one localStorage record, so the app
   works with no network, no account and no backend. */
(function () {
  'use strict';

  const t = (k, a) => I18N.t(k, a);
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const STORAGE_KEY = 'habitos.v1';
  const SCHEMA_VERSION = 1;

  const EMOJIS = [
    '🧘', '💪', '🏃', '🚶', '🚴', '🏋️', '🧠', '📓', '📖', '💧',
    '🥗', '🍎', '😴', '☀️', '🌙', '🙏', '💊', '🚭', '📵', '🧹',
    '🎯', '🎸', '🎨', '💻', '🗣️', '❤️', '🌱', '🧴',
  ];

  const CATEGORIES = [
    { id: 'mental', key: 'catMental', color: 7 },
    { id: 'fitness', key: 'catFitness', color: 2 },
    { id: 'health', key: 'catHealth', color: 3 },
    { id: 'focus', key: 'catFocus', color: 1 },
    { id: 'social', key: 'catSocial', color: 5 },
    { id: 'other', key: 'catOther', color: 4 },
  ];

  const MOODS = [1, 2, 3, 4, 5];
  const MOOD_EMOJI = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };

  /* ── Date helpers (all local time; keys are plain YYYY-MM-DD) ─────── */
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const todayKey = () => keyOf(new Date());
  const addDays = (d, n) => {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
  };
  const dayDiff = (a, b) => Math.round((parseKey(a) - parseKey(b)) / 86400000);

  /* Monday-or-Sunday aligned week id, e.g. "2026-W37". */
  function weekStartOf(date) {
    const ws = state.weekStart;
    const diff = (date.getDay() - ws + 7) % 7;
    return addDays(date, -diff);
  }
  function weekKey(date) {
    return keyOf(weekStartOf(date));
  }
  function lastNDays(n, endKey) {
    const end = parseKey(endKey || todayKey());
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(keyOf(addDays(end, -i)));
    return out;
  }
  const sentenceCase = (str) => (str ? str.charAt(0).toUpperCase() + str.slice(1) : str);

  function fmtDate(key, opts) {
    return parseKey(key).toLocaleDateString(I18N.locale(), opts || { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function dowNames(short) {
    /* Ordered by the user's week-start setting. */
    const sunday = new Date(2024, 0, 7); // a known Sunday, so dow 0 == this date
    const names = [];
    for (let i = 0; i < 7; i++) {
      const dow = (state.weekStart + i) % 7;
      names.push({
        dow: dow,
        label: addDays(sunday, dow).toLocaleDateString(I18N.locale(), { weekday: short ? 'narrow' : 'short' }),
      });
    }
    return names;
  }

  /* ── State ─────────────────────────────────────────────────────────── */
  const defaultState = () => ({
    version: SCHEMA_VERSION,
    lang: (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en',
    theme: 'system',
    weekStart: 1,
    habits: [],
    entries: {},
    moods: {},
  });

  let state = defaultState();
  let view = 'today';
  let selectedDate = todayKey();
  let showAllToday = false;
  let range = 30;
  let heatHabitId = 'all';
  let editingId = null;
  let deferredInstall = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state = Object.assign(defaultState(), parsed);
        state.habits = Array.isArray(state.habits) ? state.habits : [];
        state.entries = state.entries && typeof state.entries === 'object' ? state.entries : {};
        state.moods = state.moods && typeof state.moods === 'object' ? state.moods : {};
      }
    } catch (err) {
      console.warn('Could not read saved data', err);
    }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn('Could not save', err);
        toast('⚠️');
      }
    }, 120);
  }

  function uid() {
    return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ── Habit model helpers ───────────────────────────────────────────── */
  const activeHabits = () => state.habits.filter((h) => !h.archived);
  const habitById = (id) => state.habits.find((h) => h.id === id);
  const colorVar = (h) => 'var(--s' + (h.colorIndex || 1) + ')';

  function isScheduled(habit, key) {
    if (habit.createdAt && key < habit.createdAt) return false;
    const s = habit.schedule || { kind: 'daily' };
    if (s.kind === 'days') return (s.days || []).includes(parseKey(key).getDay());
    return true; // 'daily' and 'times' are both open every day
  }
  const targetOf = (habit) => (habit.type === 'quantity' ? Math.max(1, habit.target || 1) : 1);
  const valueOf = (habit, key) => (state.entries[habit.id] && state.entries[habit.id][key]) || 0;
  const isComplete = (habit, key) => valueOf(habit, key) >= targetOf(habit);

  function setValue(habit, key, value) {
    const bucket = state.entries[habit.id] || (state.entries[habit.id] = {});
    const clamped = Math.max(0, Math.min(value, targetOf(habit) * 4));
    if (clamped === 0) delete bucket[key];
    else bucket[key] = clamped;
    save();
  }

  function habitsFor(key) {
    return activeHabits().filter((h) => isScheduled(h, key));
  }

  /* ── Streaks ───────────────────────────────────────────────────────
     A streak only breaks on a day the habit was actually due. Today never
     breaks it: the day is not over yet. Habits with a weekly quota are
     counted in whole weeks instead of days, since a gap between the
     sessions is part of the plan rather than a miss. */
  function streakOf(habit) {
    const s = habit.schedule || { kind: 'daily' };
    return s.kind === 'times' ? weeklyStreak(habit, s) : dailyStreak(habit);
  }

  function dailyStreak(habit) {
    const today = todayKey();
    let count = 0;
    let cursor = parseKey(today);
    let guard = 0;
    while (guard++ < 800) {
      const key = keyOf(cursor);
      if (habit.createdAt && key < habit.createdAt) break;
      if (isScheduled(habit, key)) {
        if (isComplete(habit, key)) count++;
        else if (key !== today) break;   // an unfinished today is not a miss yet
      }
      cursor = addDays(cursor, -1);
    }
    return { count: count, unit: 'days' };
  }

  function weeklyStreak(habit, sched) {
    const quota = Math.max(1, Math.min(7, sched.times || 3));
    let count = 0;
    let cursor = weekStartOf(new Date());
    let guard = 0;
    let isCurrentWeek = true;
    while (guard++ < 200) {
      let done = 0;
      for (let i = 0; i < 7; i++) {
        const key = keyOf(addDays(cursor, i));
        if (key > todayKey()) break;
        if (habit.createdAt && key < habit.createdAt) continue;
        if (isComplete(habit, key)) done++;
      }
      const weekEnd = keyOf(addDays(cursor, 6));
      if (habit.createdAt && weekEnd < habit.createdAt) break;
      if (done >= quota) count++;
      else if (!isCurrentWeek) break;    // the week in progress can still be met
      isCurrentWeek = false;
      cursor = addDays(cursor, -7);
    }
    return { count: count, unit: 'weeks' };
  }

  const streakLabel = (streak) => t(streak.unit === 'weeks' ? 'streakWeeks' : 'streakDays', streak.count);

  /* ── Aggregates over a date range ──────────────────────────────────── */
  function dayStats(key) {
    const due = habitsFor(key);
    const done = due.filter((h) => isComplete(h, key)).length;
    return { due: due.length, done: done, pct: due.length ? Math.round((done / due.length) * 100) : 0 };
  }

  function rangeStats(days) {
    let due = 0;
    let done = 0;
    let perfect = 0;
    let moodSum = 0;
    let moodDays = 0;
    days.forEach((key) => {
      const d = dayStats(key);
      due += d.due;
      done += d.done;
      if (d.due > 0 && d.done === d.due) perfect++;
      const mood = state.moods[key];
      if (mood && mood.score) {
        moodSum += mood.score;
        moodDays++;
      }
    });
    return {
      completion: due ? Math.round((done / due) * 100) : 0,
      perfect: perfect,
      avgMood: moodDays ? moodSum / moodDays : null,
      moodDays: moodDays,
      due: due,
      done: done,
    };
  }

  function habitRate(habit, days) {
    let due = 0;
    let done = 0;
    days.forEach((key) => {
      if (!isScheduled(habit, key)) return;
      due++;
      if (isComplete(habit, key)) done++;
    });
    return { due: due, done: done, pct: due ? Math.round((done / due) * 100) : null };
  }

  /* ── Small UI utilities ────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 2200);
  }

  function confirmDialog(title, body) {
    return new Promise((resolve) => {
      const dlg = $('#confirmDialog');
      $('#confirmTitle').textContent = title;
      $('#confirmBody').textContent = body;
      const done = (value) => {
        dlg.close();
        $('#confirmOk').removeEventListener('click', ok);
        $('#confirmCancel').removeEventListener('click', cancel);
        resolve(value);
      };
      const ok = () => done(true);
      const cancel = () => done(false);
      $('#confirmOk').addEventListener('click', ok);
      $('#confirmCancel').addEventListener('click', cancel);
      dlg.showModal();
    });
  }

  function button(cls, label, attrs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (label !== null && label !== undefined) b.textContent = label;
    for (const k in attrs || {}) b.setAttribute(k, attrs[k]);
    return b;
  }

  function iconSvg(id, size) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" width="' + (size || 18) + '" height="' + (size || 18) + '"><use href="#' + id + '"></use></svg>';
  }

  /* ── Today view ────────────────────────────────────────────────────── */
  function renderDayStrip() {
    const strip = $('#dayStrip');
    strip.innerHTML = '';
    lastNDays(7).forEach((key) => {
      const date = parseKey(key);
      const chip = button('day-chip', null, {
        role: 'tab',
        'aria-selected': String(key === selectedDate),
        'data-date': key,
      });
      const dow = document.createElement('span');
      dow.textContent = date.toLocaleDateString(I18N.locale(), { weekday: 'narrow' });
      const num = document.createElement('span');
      num.className = 'dnum';
      num.textContent = date.getDate();
      const dot = document.createElement('span');
      const stats = dayStats(key);
      dot.className = 'ddot' + (stats.due > 0 && stats.done === stats.due ? ' filled' : '');
      chip.append(dow, num, dot);
      chip.addEventListener('click', () => {
        selectedDate = key;
        renderToday();
      });
      strip.appendChild(chip);
    });
  }

  function renderSummary() {
    const stats = dayStats(selectedDate);
    const circumference = 2 * Math.PI * 52;
    const ring = $('#ringValue');
    ring.setAttribute('stroke-dasharray', circumference.toFixed(1));
    ring.setAttribute('stroke-dashoffset', (circumference * (1 - stats.pct / 100)).toFixed(1));
    $('#summaryPct').textContent = stats.pct + '%';
    $('#summaryCount').textContent = stats.done + '/' + stats.due;
    $('#summaryDate').textContent = sentenceCase(fmtDate(selectedDate));

    const best = activeHabits().reduce((acc, h) => {
      const s = streakOf(h);
      return s.count > acc.count ? s : acc;
    }, { count: 0, unit: 'days' });
    $('#statStreak').textContent = streakLabel(best);
    $('#statWeek').textContent = rangeStats(lastNDays(7)).completion + '%';
  }

  const energyLabel = (v) => t(v <= 2 ? 'energyLow' : v >= 4 ? 'energyHigh' : 'energyMid');

  function renderMood() {
    const scale = $('#moodScale');
    const entry = state.moods[selectedDate] || null;
    scale.innerHTML = '';
    MOODS.forEach((score) => {
      const btn = button('mood-btn', null, {
        role: 'radio',
        'aria-checked': String(!!entry && entry.score === score),
        'aria-label': t('mood' + score),
      });
      btn.innerHTML = '<span class="emoji" aria-hidden="true">' + MOOD_EMOJI[score] + '</span>';
      const label = document.createElement('span');
      label.textContent = t('mood' + score);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        const current = state.moods[selectedDate];
        if (current && current.score === score) delete state.moods[selectedDate];
        else state.moods[selectedDate] = Object.assign({ energy: 3, note: '' }, current, { score: score });
        save();
        renderMood();
        renderProgressIfVisible();
      });
      scale.appendChild(btn);
    });

    const extra = $('#moodExtra');
    extra.hidden = !entry;
    $('#moodHint').textContent = entry ? t('moodSaved') : '';
    if (entry) {
      $('#moodEnergy').value = entry.energy || 3;
      $('#moodEnergyOut').textContent = energyLabel(entry.energy || 3);
      $('#moodNote').value = entry.note || '';
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function scheduleLabel(habit) {
    const s = habit.schedule || { kind: 'daily' };
    if (s.kind === 'daily') return t('schedDaily');
    if (s.kind === 'times') return (s.times || 3) + '× / ' + (I18N.getLang() === 'es' ? 'semana' : 'week');
    const names = dowNames(false);
    return (s.days || []).slice().sort((a, b) => a - b)
      .map((d) => (names.find((n) => n.dow === d) || { label: '' }).label)
      .join(' ');
  }

  function bump(habit, delta) {
    setValue(habit, selectedDate, valueOf(habit, selectedDate) + delta);
    renderToday();
    renderProgressIfVisible();
  }

  function controlFor(habit, complete) {
    if (habit.type === 'quantity') {
      const wrap = document.createElement('div');
      wrap.className = 'qty-control';
      const value = valueOf(habit, selectedDate);
      const stepSize = habit.step || 1;

      const minus = button('qty-btn', '−', { 'aria-label': '-1' });
      minus.disabled = value <= 0;
      minus.addEventListener('click', () => bump(habit, -stepSize));

      const readout = document.createElement('span');
      readout.className = 'qty-value';
      readout.innerHTML = '<strong>' + value + '</strong> / ' + targetOf(habit) +
        (habit.unit ? ' ' + escapeHtml(habit.unit) : '');

      const plus = button('qty-btn', '+', { 'aria-label': '+1' });
      plus.addEventListener('click', () => bump(habit, stepSize));

      wrap.append(minus, readout, plus);
      return wrap;
    }

    const check = button('check-btn', null, {
      'aria-pressed': String(complete),
      'aria-label': habit.name + ' — ' + t('doneToday'),
    });
    check.addEventListener('click', () => {
      setValue(habit, selectedDate, complete ? 0 : 1);
      renderToday();
      renderProgressIfVisible();
    });
    return check;
  }

  function renderHabitList() {
    const list = $('#habitList');
    const all = activeHabits();
    const due = habitsFor(selectedDate);
    const shown = showAllToday ? all : due;
    list.innerHTML = '';
    $('#todayEmpty').hidden = shown.length > 0;
    $('#todayEmpty').querySelector('p').textContent =
      all.length === 0 ? t('emptyHabitsTitle') : t('emptyTodayTitle');

    shown.forEach((habit) => {
      const scheduled = isScheduled(habit, selectedDate);
      const complete = isComplete(habit, selectedDate);
      const li = document.createElement('li');
      li.className = 'habit-row' + (complete ? ' is-done' : '') + (scheduled ? '' : ' is-off');
      li.style.setProperty('--habit-color', colorVar(habit));

      const badge = document.createElement('span');
      badge.className = 'habit-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = habit.emoji || '✅';

      const main = document.createElement('div');
      main.className = 'habit-main';
      const name = document.createElement('span');
      name.className = 'habit-name';
      name.textContent = habit.name;

      const meta = document.createElement('span');
      meta.className = 'habit-meta';
      const streak = streakOf(habit);
      if (streak.count > 0) {
        const flame = document.createElement('span');
        flame.className = 'streak';
        flame.innerHTML = iconSvg('i-flame', 13);
        flame.appendChild(document.createTextNode(' ' + streakLabel(streak)));
        meta.appendChild(flame);
      }
      const sched = document.createElement('span');
      sched.textContent = scheduled ? scheduleLabel(habit) : t('notToday');
      meta.appendChild(sched);
      main.append(name, meta);

      if (habit.type === 'quantity') {
        const track = document.createElement('div');
        track.className = 'progress-track';
        const fill = document.createElement('div');
        fill.className = 'progress-fill';
        fill.style.width = Math.min(100, (valueOf(habit, selectedDate) / targetOf(habit)) * 100) + '%';
        track.appendChild(fill);
        main.appendChild(track);
      }

      li.append(badge, main, controlFor(habit, complete));
      list.appendChild(li);
    });
  }

  function renderToday() {
    renderDayStrip();
    renderSummary();
    renderMood();
    renderHabitList();
  }

  /* ── Habits view ───────────────────────────────────────────────────── */
  const PRESETS = [
    { key: 'presetMeditate', emoji: '🧘', colorIndex: 7, category: 'mental', type: 'quantity', target: 10, unitKey: 'unitMin', schedule: { kind: 'daily' } },
    { key: 'presetGratitude', emoji: '🙏', colorIndex: 5, category: 'mental', type: 'binary', schedule: { kind: 'daily' } },
    { key: 'presetWalk', emoji: '🚶', colorIndex: 3, category: 'fitness', type: 'binary', schedule: { kind: 'daily' } },
    { key: 'presetGym', emoji: '💪', colorIndex: 2, category: 'fitness', type: 'binary', schedule: { kind: 'times', times: 3 } },
    { key: 'presetWater', emoji: '💧', colorIndex: 1, category: 'health', type: 'quantity', target: 8, unitKey: 'unitGlasses', schedule: { kind: 'daily' } },
    { key: 'presetSleep', emoji: '😴', colorIndex: 4, category: 'health', type: 'binary', schedule: { kind: 'daily' } },
    { key: 'presetRead', emoji: '📖', colorIndex: 6, category: 'focus', type: 'quantity', target: 20, unitKey: 'unitPages', schedule: { kind: 'daily' } },
    { key: 'presetNoPhone', emoji: '📵', colorIndex: 8, category: 'mental', type: 'binary', schedule: { kind: 'daily' } },
  ];

  function renderPresets() {
    const grid = $('#presetGrid');
    grid.innerHTML = '';
    PRESETS.forEach((preset) => {
      const chip = button('preset-chip', null);
      chip.innerHTML = '<span aria-hidden="true">' + preset.emoji + '</span>';
      chip.appendChild(document.createTextNode(t(preset.key)));
      chip.addEventListener('click', () => {
        state.habits.push({
          id: uid(),
          name: t(preset.key),
          emoji: preset.emoji,
          colorIndex: preset.colorIndex,
          category: preset.category,
          type: preset.type,
          target: preset.target || 1,
          unit: preset.unitKey ? t(preset.unitKey) : '',
          schedule: JSON.parse(JSON.stringify(preset.schedule)),
          createdAt: todayKey(),
          archived: false,
        });
        save();
        renderHabitsView();
        renderToday();
        toast(t('habitSaved'));
      });
      grid.appendChild(chip);
    });
  }

  function manageRow(habit, archived) {
    const li = document.createElement('li');
    li.className = 'manage-row';
    li.style.setProperty('--habit-color', colorVar(habit));

    const badge = document.createElement('span');
    badge.className = 'habit-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = habit.emoji || '✅';

    const open = button('habit-main', null, { 'aria-label': t('editHabit') + ': ' + habit.name });
    open.style.textAlign = 'left';
    const name = document.createElement('span');
    name.className = 'habit-name';
    name.textContent = habit.name;
    const meta = document.createElement('span');
    meta.className = 'habit-meta';
    meta.textContent = scheduleLabel(habit) + ' · ' +
      (habit.type === 'quantity' ? targetOf(habit) + ' ' + (habit.unit || '') : t('typeBinary'));
    open.append(name, meta);
    open.addEventListener('click', () => openHabitDialog(habit.id));

    const actions = document.createElement('div');
    actions.className = 'manage-actions';

    if (archived) {
      const restore = button('icon-btn', null, { 'aria-label': t('restore'), title: t('restore') });
      restore.innerHTML = iconSvg('i-restore');
      restore.addEventListener('click', () => {
        habit.archived = false;
        save();
        renderHabitsView();
        renderToday();
        toast(t('habitRestored'));
      });
      actions.appendChild(restore);
    } else {
      const archive = button('icon-btn', null, { 'aria-label': t('archive'), title: t('archive') });
      archive.innerHTML = iconSvg('i-archive');
      archive.addEventListener('click', () => {
        habit.archived = true;
        save();
        renderHabitsView();
        renderToday();
        toast(t('habitArchived'));
      });
      const up = button('icon-btn', '↑', { 'aria-label': t('moveUp'), title: t('moveUp') });
      up.addEventListener('click', () => reorder(habit.id, -1));
      const down = button('icon-btn', '↓', { 'aria-label': t('moveDown'), title: t('moveDown') });
      down.addEventListener('click', () => reorder(habit.id, 1));
      actions.append(up, down, archive);
    }

    li.append(badge, open, actions);
    return li;
  }

  function reorder(id, delta) {
    const list = state.habits;
    const from = list.findIndex((h) => h.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    save();
    renderHabitsView();
    renderToday();
  }

  function renderHabitsView() {
    const active = activeHabits();
    const archived = state.habits.filter((h) => h.archived);
    const list = $('#manageList');
    list.innerHTML = '';
    active.forEach((h) => list.appendChild(manageRow(h, false)));
    $('#habitsEmpty').hidden = active.length > 0;
    if (active.length === 0) renderPresets();

    const block = $('#archiveBlock');
    block.hidden = archived.length === 0;
    const archList = $('#archiveList');
    archList.innerHTML = '';
    archived.forEach((h) => archList.appendChild(manageRow(h, true)));
  }

  /* ── Habit editor ──────────────────────────────────────────────────── */
  let draft = null;

  function blankDraft() {
    return {
      id: null,
      name: '',
      emoji: '🧘',
      colorIndex: 1,
      category: 'mental',
      type: 'binary',
      target: 1,
      unit: '',
      schedule: { kind: 'daily', days: [1, 3, 5], times: 3 },
    };
  }

  function buildEmojiGrid() {
    const grid = $('#emojiGrid');
    grid.innerHTML = '';
    EMOJIS.forEach((emoji) => {
      const btn = button('emoji-btn', emoji, { role: 'radio', 'aria-checked': String(draft.emoji === emoji), 'aria-label': emoji });
      btn.addEventListener('click', () => {
        draft.emoji = emoji;
        buildEmojiGrid();
      });
      grid.appendChild(btn);
    });
  }

  function buildColorRow() {
    const row = $('#colorRow');
    row.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
      const btn = button('swatch', null, { role: 'radio', 'aria-checked': String(draft.colorIndex === i), 'aria-label': 'Color ' + i });
      btn.style.background = 'var(--s' + i + ')';
      btn.addEventListener('click', () => {
        draft.colorIndex = i;
        buildColorRow();
      });
      row.appendChild(btn);
    }
  }

  function buildSegmented(host, options, current, onPick) {
    host.innerHTML = '';
    options.forEach((opt) => {
      const btn = button('', opt.label, { role: 'radio', 'aria-checked': String(current === opt.value) });
      btn.addEventListener('click', () => onPick(opt.value));
      host.appendChild(btn);
    });
  }

  function buildDowRow() {
    const row = $('#dowRow');
    row.innerHTML = '';
    dowNames(false).forEach((day) => {
      const on = draft.schedule.days.includes(day.dow);
      const btn = button('dow-btn', day.label, { 'aria-pressed': String(on) });
      btn.addEventListener('click', () => {
        const days = draft.schedule.days;
        const at = days.indexOf(day.dow);
        if (at >= 0) days.splice(at, 1);
        else days.push(day.dow);
        buildDowRow();
      });
      row.appendChild(btn);
    });
  }

  function syncDialogFields() {
    $('#quantityFields').hidden = draft.type !== 'quantity';
    $('#daysField').hidden = draft.schedule.kind !== 'days';
    $('#timesField').hidden = draft.schedule.kind !== 'times';

    buildSegmented($('#typeSelect'), [
      { value: 'binary', label: t('typeBinary') },
      { value: 'quantity', label: t('typeQuantity') },
    ], draft.type, (value) => {
      draft.type = value;
      syncDialogFields();
    });

    buildSegmented($('#scheduleSelect'), [
      { value: 'daily', label: t('schedDaily') },
      { value: 'days', label: t('schedDays') },
      { value: 'times', label: t('schedTimes') },
    ], draft.schedule.kind, (value) => {
      draft.schedule.kind = value;
      syncDialogFields();
    });

    buildDowRow();
  }

  function openHabitDialog(id) {
    editingId = id || null;
    const existing = id ? habitById(id) : null;
    draft = existing
      ? {
          id: existing.id,
          name: existing.name,
          emoji: existing.emoji || '🧘',
          colorIndex: existing.colorIndex || 1,
          category: existing.category || 'other',
          type: existing.type || 'binary',
          target: existing.target || 1,
          unit: existing.unit || '',
          schedule: Object.assign({ kind: 'daily', days: [1, 3, 5], times: 3 }, existing.schedule),
        }
      : blankDraft();
    if (!Array.isArray(draft.schedule.days)) draft.schedule.days = [1, 3, 5];

    $('#habitDialogTitle').textContent = existing ? t('editHabit') : t('addHabit');
    $('#fName').value = draft.name;
    $('#fTarget').value = draft.target;
    $('#fUnit').value = draft.unit;
    $('#fTimes').value = draft.schedule.times || 3;
    $('#fCategory').value = draft.category;
    $('#formError').hidden = true;
    $('#btnDeleteHabit').hidden = !existing;

    buildEmojiGrid();
    buildColorRow();
    syncDialogFields();
    $('#habitDialog').showModal();
    setTimeout(() => $('#fName').focus(), 60);
  }

  function readDialog() {
    draft.name = $('#fName').value.trim();
    draft.target = parseInt($('#fTarget').value, 10) || 0;
    draft.unit = $('#fUnit').value.trim();
    draft.category = $('#fCategory').value;
    draft.schedule.times = Math.max(1, Math.min(7, parseInt($('#fTimes').value, 10) || 3));
  }

  function saveHabit() {
    readDialog();
    const fail = (msg) => {
      const box = $('#formError');
      box.textContent = msg;
      box.hidden = false;
      return false;
    };
    if (!draft.name) return fail(t('errName'));
    if (draft.type === 'quantity' && draft.target < 1) return fail(t('errTarget'));
    if (draft.schedule.kind === 'days' && draft.schedule.days.length === 0) return fail(t('errDays'));

    const payload = {
      name: draft.name,
      emoji: draft.emoji,
      colorIndex: draft.colorIndex,
      category: draft.category,
      type: draft.type,
      target: draft.type === 'quantity' ? draft.target : 1,
      unit: draft.type === 'quantity' ? draft.unit : '',
      schedule: draft.schedule,
    };

    if (editingId) {
      Object.assign(habitById(editingId), payload);
    } else {
      state.habits.push(Object.assign({ id: uid(), createdAt: todayKey(), archived: false }, payload));
    }
    save();
    $('#habitDialog').close();
    renderHabitsView();
    renderToday();
    renderProgressIfVisible();
    toast(t('habitSaved'));
    return true;
  }

  /* ── Progress view ─────────────────────────────────────────────────── */
  function levelFor(ratio) {
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 5;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
    return 4;
  }

  function statTile(value, label) {
    const box = document.createElement('div');
    box.className = 'stat-tile';
    const v = document.createElement('span');
    v.className = 'stat-value';
    v.textContent = value;
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    box.append(v, l);
    return box;
  }

  function renderRangeSelect() {
    buildSegmented($('#rangeSelect'), [
      { value: 7, label: t('range7') },
      { value: 30, label: t('range30') },
      { value: 90, label: t('range90') },
    ], range, (value) => {
      range = value;
      renderProgress();
    });
  }

  function renderProgressStats(days) {
    const stats = rangeStats(days);
    const grid = $('#progressStats');
    grid.innerHTML = '';
    grid.append(
      statTile(stats.completion + '%', t('statCompletion')),
      statTile(String(stats.perfect), t('statPerfectDays')),
      statTile(stats.avgMood ? stats.avgMood.toFixed(1) : t('noneYet'), t('statAvgMood')),
      statTile(String(stats.moodDays), t('statLogged'))
    );
  }

  function renderMoodChart(days) {
    const has = days.some((key) => state.moods[key] && state.moods[key].score);
    $('#chartMoodEmpty').hidden = has;
    const host = $('#chartMood');
    host.hidden = !has;
    if (!has) { host.innerHTML = ''; return; }

    const points = days.map((key) => {
      const mood = state.moods[key];
      const score = mood && mood.score ? mood.score : null;
      const dateLabel = fmtDate(key, { day: 'numeric', month: 'short' });
      let tip = '<b>' + dateLabel + '</b>';
      if (score) {
        tip += '<br>' + MOOD_EMOJI[score] + ' ' + t('mood' + score);
        if (mood.note) tip += '<br><span class="tip-sub">' + escapeHtml(mood.note.slice(0, 60)) + '</span>';
      }
      return { label: dateLabel, value: score, tip: tip };
    });

    Charts.line(host, {
      points: points,
      min: 1,
      max: 5,
      yTicks: [1, 2, 3, 4, 5],
      color: 'var(--s1)',
      ariaLabel: t('chartMoodTitle'),
    });
  }

  function renderRatesChart(days) {
    const items = activeHabits()
      .map((habit) => {
        const rate = habitRate(habit, days);
        return { habit: habit, rate: rate };
      })
      .filter((row) => row.rate.due > 0)
      .sort((a, b) => b.rate.pct - a.rate.pct);

    $('#chartRatesEmpty').hidden = items.length > 0;
    const host = $('#chartRates');
    host.hidden = items.length === 0;
    $('#chartRatesSub').textContent = t('chartRatesSubFmt', days.length);
    if (!items.length) { host.innerHTML = ''; return; }

    Charts.bars(host, {
      max: 100,
      ariaLabel: t('chartRatesTitle'),
      items: items.map((row) => ({
        label: row.habit.emoji + ' ' + row.habit.name,
        value: row.rate.pct,
        valueLabel: row.rate.pct + '%',
        color: colorVar(row.habit),
        sub: row.rate.done + '/' + row.rate.due,
        tip: '<b>' + escapeHtml(row.habit.name) + '</b><br>' + row.rate.done + ' ' + t('of') + ' ' + row.rate.due,
      })),
    });
  }

  function renderHeatSelect() {
    const select = $('#heatHabit');
    const previous = heatHabitId;
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = t('allHabits');
    select.appendChild(all);
    activeHabits().forEach((habit) => {
      const opt = document.createElement('option');
      opt.value = habit.id;
      opt.textContent = habit.emoji + ' ' + habit.name;
      select.appendChild(opt);
    });
    heatHabitId = habitById(previous) && !habitById(previous).archived ? previous : 'all';
    select.value = heatHabitId;
  }

  function renderHeatmap(days) {
    const host = $('#chartHeat');
    const habit = heatHabitId === 'all' ? null : habitById(heatHabitId);

    const cells = days.map((key) => {
      const dateLabel = fmtDate(key, { weekday: 'short', day: 'numeric', month: 'short' });
      let level = 0;
      let scheduled = true;
      let detail;
      if (habit) {
        scheduled = isScheduled(habit, key);
        const ratio = valueOf(habit, key) / targetOf(habit);
        level = levelFor(ratio);
        detail = habit.type === 'quantity'
          ? valueOf(habit, key) + ' / ' + targetOf(habit) + (habit.unit ? ' ' + habit.unit : '')
          : isComplete(habit, key) ? t('doneToday') : '—';
      } else {
        const stats = dayStats(key);
        scheduled = stats.due > 0;
        level = levelFor(stats.due ? stats.done / stats.due : 0);
        detail = stats.done + '/' + stats.due;
      }
      const date = parseKey(key);
      return {
        level: level,
        scheduled: scheduled,
        monthLabel: date.getDate() <= 7 ? date.toLocaleDateString(I18N.locale(), { month: 'short' }) : null,
        tip: '<b>' + dateLabel + '</b><br><span class="tip-sub">' + escapeHtml(detail) + '</span>',
      };
    });

    const first = parseKey(days[0]);
    Charts.heatmap(host, {
      days: cells,
      firstOffset: (first.getDay() - state.weekStart + 7) % 7,
      dowLabels: dowNames(true).map((d) => d.label),
      lessLabel: t('less'),
      moreLabel: t('more'),
      ariaLabel: t('chartHeatTitle'),
    });
  }

  /* Average mood on days the habit was completed versus days it was not.
     Needs at least two days on each side before it says anything. */
  function renderCorrelation(days) {
    const groups = [];
    activeHabits().forEach((habit) => {
      let doneSum = 0, doneN = 0, missSum = 0, missN = 0;
      days.forEach((key) => {
        const mood = state.moods[key];
        if (!mood || !mood.score || !isScheduled(habit, key)) return;
        if (isComplete(habit, key)) { doneSum += mood.score; doneN++; }
        else { missSum += mood.score; missN++; }
      });
      if (doneN < 2 || missN < 2) return;
      groups.push({
        label: habit.emoji + ' ' + habit.name,
        values: [
          { value: doneSum / doneN, valueLabel: (doneSum / doneN).toFixed(1), tip: '<b>' + t('legendDone') + '</b><br>' + doneN + ' ' + (I18N.getLang() === 'es' ? 'días' : 'days') },
          { value: missSum / missN, valueLabel: (missSum / missN).toFixed(1), tip: '<b>' + t('legendMissed') + '</b><br>' + missN + ' ' + (I18N.getLang() === 'es' ? 'días' : 'days') },
        ],
      });
    });

    $('#chartCorrEmpty').hidden = groups.length > 0;
    const host = $('#chartCorr');
    host.hidden = groups.length === 0;
    if (!groups.length) { host.innerHTML = ''; return; }

    Charts.groupedBars(host, {
      groups: groups,
      max: 5,
      series: [
        { name: t('legendDone'), color: 'var(--s1)' },
        { name: t('legendMissed'), color: 'var(--s2)' },
      ],
      ariaLabel: t('chartCorrTitle'),
    });
  }

  function renderTable(days) {
    const head = $('#dataTableHead');
    const body = $('#dataTableBody');
    head.innerHTML = '<tr><th>' + t('tableDate') + '</th><th>' + t('tableMood') + '</th><th>' + t('tableDone') + '</th></tr>';
    body.innerHTML = '';
    days.slice().reverse().forEach((key) => {
      const stats = dayStats(key);
      const mood = state.moods[key];
      const tr = document.createElement('tr');
      const cells = [
        fmtDate(key, { day: 'numeric', month: 'short', year: undefined }),
        mood && mood.score ? MOOD_EMOJI[mood.score] + ' ' + mood.score : t('noneYet'),
        stats.due ? stats.done + '/' + stats.due : t('noneYet'),
      ];
      cells.forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function renderProgress() {
    const days = lastNDays(range);
    renderRangeSelect();
    renderProgressStats(days);
    renderMoodChart(days);
    renderRatesChart(days);
    renderHeatSelect();
    renderHeatmap(days);
    renderCorrelation(days);
    renderTable(days);
  }

  function renderProgressIfVisible() {
    if (view === 'progress') renderProgress();
  }

  /* ── Theme & language ──────────────────────────────────────────────── */
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const resolved = state.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : state.theme;
    document.documentElement.setAttribute('data-theme', resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0D1117' : '#F4F5F7');
    $('#themeSelect').value = state.theme;
  }

  function fillCategorySelect() {
    const select = $('#fCategory');
    select.innerHTML = '';
    CATEGORIES.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = t(cat.key);
      select.appendChild(opt);
    });
  }

  function applyLang() {
    I18N.setLang(state.lang);
    document.documentElement.lang = state.lang;
    document.title = t('appName');

    $$('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });

    $('#langToggleLabel').textContent = state.lang === 'es' ? 'EN' : 'ES';
    $('#langSelect').value = state.lang;
    $('#weekStart').value = String(state.weekStart);
    fillCategorySelect();
    updateViewTitle();
    updateStorageInfo();
    renderAll();
  }

  function updateViewTitle() {
    const titles = { today: 'navToday', habits: 'navHabits', progress: 'navProgress', settings: 'navSettings' };
    $('#viewTitle').textContent = t(titles[view]);
  }

  function updateStorageInfo() {
    const logged = new Set(Object.keys(state.moods));
    Object.keys(state.entries).forEach((id) => Object.keys(state.entries[id]).forEach((key) => logged.add(key)));
    $('#storageInfo').textContent = t('storageFmt', logged.size);
  }

  /* ── Navigation ────────────────────────────────────────────────────── */
  const VIEWS = ['today', 'habits', 'progress', 'settings'];

  function setView(name, fromHash) {
    view = VIEWS.includes(name) ? name : 'today';
    name = view;
    if (!fromHash && location.hash.slice(1) !== name) {
      history.replaceState(null, '', '#' + name);
    }
    VIEWS.forEach((id) => {
      $('#view-' + id).hidden = id !== name;
    });
    $$('#tabBar .tab').forEach((tab) => {
      if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    updateViewTitle();
    if (name === 'today') renderToday();
    if (name === 'habits') renderHabitsView();
    if (name === 'progress') renderProgress();
    if (name === 'settings') updateStorageInfo();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function renderAll() {
    renderToday();
    renderHabitsView();
    if (view === 'progress') renderProgress();
  }

  /* ── Import / export ───────────────────────────────────────────────── */
  function exportData() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'habitos-' + todayKey() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('exported'));
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || !Array.isArray(parsed.habits)) throw new Error('bad shape');
        state = Object.assign(defaultState(), parsed);
        state.entries = state.entries || {};
        state.moods = state.moods || {};
        save();
        applyTheme();
        applyLang();
        toast(t('imported'));
      } catch (err) {
        console.warn(err);
        toast(t('importFailed'));
      }
    };
    reader.onerror = () => toast(t('importFailed'));
    reader.readAsText(file);
  }

  /* ── Install prompt ────────────────────────────────────────────────── */
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function updateInstallUi() {
    const btn = $('#btnInstall');
    const hint = $('#installHint');
    if (isStandalone()) {
      btn.hidden = true;
      hint.textContent = t('installHintInstalled');
      return;
    }
    if (deferredInstall) {
      btn.hidden = false;
      hint.textContent = t('installHintReady');
      return;
    }
    btn.hidden = true;
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    hint.textContent = iOS ? t('installHintIOS') : t('installHintOther');
  }

  window.addEventListener('beforeinstallprompt', (evt) => {
    evt.preventDefault();
    deferredInstall = evt;
    updateInstallUi();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    updateInstallUi();
  });

  /* ── Wiring ────────────────────────────────────────────────────────── */
  function wire() {
    $$('#tabBar .tab').forEach((tab) => {
      tab.addEventListener('click', () => setView(tab.dataset.view));
    });

    $$('[data-action="new-habit"]').forEach((btn) => {
      btn.addEventListener('click', () => openHabitDialog(null));
    });

    $('#showAllToggle').addEventListener('change', (evt) => {
      showAllToday = evt.target.checked;
      renderHabitList();
    });

    $('#moodEnergy').addEventListener('input', (evt) => {
      const entry = state.moods[selectedDate];
      if (!entry) return;
      entry.energy = Number(evt.target.value);
      $('#moodEnergyOut').textContent = energyLabel(entry.energy);
      save();
    });
    $('#moodNote').addEventListener('input', (evt) => {
      const entry = state.moods[selectedDate];
      if (!entry) return;
      entry.note = evt.target.value;
      save();
    });

    $('#heatHabit').addEventListener('change', (evt) => {
      heatHabitId = evt.target.value;
      renderHeatmap(lastNDays(range));
    });

    /* Habit dialog */
    $('#habitForm').addEventListener('submit', (evt) => {
      evt.preventDefault();
      saveHabit();
    });
    $$('#habitDialog [data-close]').forEach((btn) => {
      btn.addEventListener('click', () => $('#habitDialog').close());
    });
    $('#btnDeleteHabit').addEventListener('click', async () => {
      const ok = await confirmDialog(t('deleteHabitTitle'), t('deleteHabitBody'));
      if (!ok) return;
      state.habits = state.habits.filter((h) => h.id !== editingId);
      delete state.entries[editingId];
      save();
      $('#habitDialog').close();
      renderHabitsView();
      renderToday();
      renderProgressIfVisible();
      toast(t('habitDeleted'));
    });

    /* Settings */
    $('#langSelect').addEventListener('change', (evt) => {
      state.lang = evt.target.value;
      save();
      applyLang();
    });
    $('#langToggle').addEventListener('click', () => {
      state.lang = state.lang === 'es' ? 'en' : 'es';
      save();
      applyLang();
    });
    $('#themeSelect').addEventListener('change', (evt) => {
      state.theme = evt.target.value;
      save();
      applyTheme();
      renderProgressIfVisible();
    });
    $('#themeToggle').addEventListener('click', () => {
      const resolved = document.documentElement.getAttribute('data-theme');
      state.theme = resolved === 'dark' ? 'light' : 'dark';
      save();
      applyTheme();
      renderProgressIfVisible();
    });
    $('#weekStart').addEventListener('change', (evt) => {
      state.weekStart = Number(evt.target.value);
      save();
      renderAll();
    });

    $('#btnExport').addEventListener('click', exportData);
    $('#btnImport').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (evt) => {
      const file = evt.target.files && evt.target.files[0];
      if (file) importData(file);
      evt.target.value = '';
    });
    $('#btnReset').addEventListener('click', async () => {
      const ok = await confirmDialog(t('resetTitle'), t('resetBody'));
      if (!ok) return;
      state = defaultState();
      state.lang = I18N.getLang();
      save();
      applyTheme();
      applyLang();
      setView('today');
      toast(t('resetDone'));
    });
    $('#btnInstall').addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      updateInstallUi();
    });

    systemDark.addEventListener('change', () => {
      if (state.theme === 'system') {
        applyTheme();
        renderProgressIfVisible();
      }
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderProgressIfVisible, 180);
    });

    /* A tab left open past midnight should roll over to the new day. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (selectedDate < todayKey()) selectedDate = todayKey();
      renderAll();
    });
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */
  function init() {
    load();
    wire();
    applyTheme();
    applyLang();
    setView(location.hash.slice(1) || 'today', true);
    updateInstallUi();

    window.addEventListener('hashchange', () => setView(location.hash.slice(1) || 'today', true));

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW failed', err));
      });
    }
  }

  init();
})();
