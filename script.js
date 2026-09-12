/* =====================================================================
   FOCUSFLOW — APPLICATION LOGIC
   Sections:
   1. Application state      7. Sound system
   2. DOM references         8. Focus Mode
   3. LocalStorage           9. UI rendering
   4. Clock                 10. Event listeners
   5. Timer                 11. Initialization
   6. Tasks
===================================================================== */

(function () {
  'use strict';

  /* ===================================================================
     1. APPLICATION STATE
  =================================================================== */
  const state = {
    focusText: '',
    tasks: [],              // { id, text, done }
    dailyGoal: 4,
    completedSessions: 0,
    lastSessionDate: null,  // 'YYYY-MM-DD'
    soundEnabled: true,
    timer: {
      presetMinutes: 25,     // 25 | 50 | 'custom'
      customMinutes: 25,
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      isRunning: false,
      intervalId: null,
    },
    focusModeActive: false,
  };

  const RING_RADIUS = 105;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const STORAGE_KEYS = {
    TASKS: 'focusflow_tasks',
    SETTINGS: 'focusflow_settings',
    DAILY_PROGRESS: 'focusflow_daily_progress',
  };


  /* ===================================================================
     2. DOM REFERENCES
  =================================================================== */
  const dom = {
    clockTime: document.getElementById('clockTime'),
    clockDate: document.getElementById('clockDate'),
    soundToggle: document.getElementById('soundToggle'),
    soundIcon: document.getElementById('soundIcon'),

    focusDisplayWrap: document.getElementById('focusDisplayWrap'),
    focusDisplay: document.getElementById('focusDisplay'),
    focusEditBtn: document.getElementById('focusEditBtn'),
    focusForm: document.getElementById('focusForm'),
    focusInput: document.getElementById('focusInput'),

    timerRingProgress: document.getElementById('timerRingProgress'),
    timerDisplay: document.getElementById('timerDisplay'),
    timerState: document.getElementById('timerState'),
    timerCard: document.querySelector('.timer-card'),

    presetButtons: Array.from(document.querySelectorAll('.preset-btn')),
    customPresetBtn: document.getElementById('customPresetBtn'),
    customDurationWrap: document.getElementById('customDurationWrap'),
    customDurationInput: document.getElementById('customDurationInput'),
    applyCustomDuration: document.getElementById('applyCustomDuration'),

    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resetBtn: document.getElementById('resetBtn'),
    sessionCount: document.getElementById('sessionCount'),

    taskForm: document.getElementById('taskForm'),
    taskInput: document.getElementById('taskInput'),
    taskList: document.getElementById('taskList'),
    taskEmptyState: document.getElementById('taskEmptyState'),
    taskProgress: document.getElementById('taskProgress'),

    goalHearts: document.getElementById('goalHearts'),
    goalText: document.getElementById('goalText'),
    goalEditBtn: document.getElementById('goalEditBtn'),
    goalForm: document.getElementById('goalForm'),
    goalInput: document.getElementById('goalInput'),

    focusModeToggle: document.getElementById('focusModeToggle'),
    exitFocusModeBtn: document.getElementById('exitFocusModeBtn'),
  };


  /* ===================================================================
     3. LOCALSTORAGE
  =================================================================== */
  function safeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('FocusFlow: could not read "' + key + '" from storage, using default.', err);
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('FocusFlow: could not save "' + key + '" to storage.', err);
    }
  }

  function persistTasks() {
    safeSet(STORAGE_KEYS.TASKS, state.tasks);
  }

  function persistSettings() {
    safeSet(STORAGE_KEYS.SETTINGS, {
      soundEnabled: state.soundEnabled,
      dailyGoal: state.dailyGoal,
      focusText: state.focusText,
      presetMinutes: state.timer.presetMinutes,
      customMinutes: state.timer.customMinutes,
    });
  }

  function persistDailyProgress() {
    safeSet(STORAGE_KEYS.DAILY_PROGRESS, {
      date: state.lastSessionDate,
      completedSessions: state.completedSessions,
    });
  }

  function loadState() {
    // Tasks — validate shape defensively in case of malformed data.
    const rawTasks = safeGet(STORAGE_KEYS.TASKS, []);
    state.tasks = Array.isArray(rawTasks)
      ? rawTasks.filter((t) => t && typeof t.text === 'string').map((t) => ({
          id: typeof t.id === 'string' ? t.id : generateId(),
          text: t.text,
          done: Boolean(t.done),
        }))
      : [];

    // Settings
    const settings = safeGet(STORAGE_KEYS.SETTINGS, {});
    state.soundEnabled = typeof settings.soundEnabled === 'boolean' ? settings.soundEnabled : true;
    state.dailyGoal = isValidGoal(settings.dailyGoal) ? settings.dailyGoal : 4;
    state.focusText = typeof settings.focusText === 'string' ? settings.focusText : '';

    const validPreset = settings.presetMinutes === 25 || settings.presetMinutes === 50 || settings.presetMinutes === 'custom';
    state.timer.presetMinutes = validPreset ? settings.presetMinutes : 25;
    state.timer.customMinutes = isValidDuration(settings.customMinutes) ? settings.customMinutes : 25;

    const activeMinutes = state.timer.presetMinutes === 'custom' ? state.timer.customMinutes : state.timer.presetMinutes;
    state.timer.totalSeconds = activeMinutes * 60;
    state.timer.remainingSeconds = activeMinutes * 60;

    // Daily progress — reset automatically if it's a new calendar day.
    const progress = safeGet(STORAGE_KEYS.DAILY_PROGRESS, {});
    const today = todayDateString();
    if (progress.date === today && Number.isInteger(progress.completedSessions)) {
      state.lastSessionDate = today;
      state.completedSessions = progress.completedSessions;
    } else {
      state.lastSessionDate = today;
      state.completedSessions = 0;
      persistDailyProgress();
    }
  }

  function isValidGoal(value) {
    return Number.isInteger(value) && value >= 1 && value <= 12;
  }

  function isValidDuration(value) {
    return Number.isInteger(value) && value >= 1 && value <= 180;
  }


  /* ===================================================================
     4. CLOCK
  =================================================================== */
  const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    const meridiem = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;

    dom.clockTime.textContent = `${pad(hours)}:${minutes}:${seconds} ${meridiem}`;
    dom.clockDate.textContent = `${WEEKDAYS[now.getDay()]} • ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  }

  function todayDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }


  /* ===================================================================
     5. TIMER
  =================================================================== */
  function formatTime(totalSeconds) {
    const safeSeconds = Math.max(0, totalSeconds);
    const m = Math.floor(safeSeconds / 60);
    const s = safeSeconds % 60;
    return `${pad(m)}:${pad(s)}`;
  }

  function updateTimerDisplay() {
    dom.timerDisplay.textContent = formatTime(state.timer.remainingSeconds);
  }

  function updateRingProgress() {
    const fraction = state.timer.totalSeconds > 0
      ? (state.timer.totalSeconds - state.timer.remainingSeconds) / state.timer.totalSeconds
      : 0;
    const offset = RING_CIRCUMFERENCE * (1 - fraction);
    dom.timerRingProgress.style.strokeDashoffset = String(offset);
  }

  function setTimerStateLabel(label) {
    dom.timerState.textContent = label;
  }

  function updateActivePresetUI() {
    dom.presetButtons.forEach((btn) => {
      const isCustom = btn.dataset.minutes === 'custom';
      const matches = isCustom
        ? state.timer.presetMinutes === 'custom'
        : Number(btn.dataset.minutes) === state.timer.presetMinutes;
      btn.classList.toggle('is-active', matches);
    });
    dom.customPresetBtn.textContent = state.timer.presetMinutes === 'custom'
      ? `CUSTOM · ${state.timer.customMinutes}M`
      : 'CUSTOM';
  }

  function setDurationControlsDisabled(disabled) {
    dom.presetButtons.forEach((btn) => { btn.disabled = disabled; });
    dom.customDurationInput.disabled = disabled;
    dom.applyCustomDuration.disabled = disabled;
  }

  function setPreset(minutesValue) {
    if (state.timer.isRunning) return; // guard: no duration changes mid-session

    if (minutesValue === 'custom') {
      dom.customDurationInput.value = state.timer.customMinutes;
      dom.customDurationWrap.classList.remove('hidden');
      state.timer.presetMinutes = 'custom';
      state.timer.totalSeconds = state.timer.customMinutes * 60;
      state.timer.remainingSeconds = state.timer.customMinutes * 60;
    } else {
      dom.customDurationWrap.classList.add('hidden');
      state.timer.presetMinutes = minutesValue;
      state.timer.totalSeconds = minutesValue * 60;
      state.timer.remainingSeconds = minutesValue * 60;
    }

    updateTimerDisplay();
    updateRingProgress();
    updateActivePresetUI();
    persistSettings();
  }

  function applyCustomDurationValue() {
    if (state.timer.isRunning) return;
    const value = parseInt(dom.customDurationInput.value, 10);

    if (!isValidDuration(value)) {
      dom.customDurationInput.classList.add('is-invalid');
      dom.customDurationInput.value = state.timer.customMinutes;
      setTimeout(() => dom.customDurationInput.classList.remove('is-invalid'), 400);
      return;
    }

    state.timer.customMinutes = value;
    state.timer.presetMinutes = 'custom';
    state.timer.totalSeconds = value * 60;
    state.timer.remainingSeconds = value * 60;

    updateTimerDisplay();
    updateRingProgress();
    updateActivePresetUI();
    persistSettings();
  }

  function startTimer() {
    if (state.timer.isRunning) return; // guard: prevent double-start
    if (state.timer.remainingSeconds <= 0) resetTimer();

    state.timer.isRunning = true;
    dom.timerCard.classList.add('timer-active');
    setTimerStateLabel('SESSION ACTIVE');
    setDurationControlsDisabled(true);
    playStartSound();

    dom.startBtn.disabled = true;
    dom.pauseBtn.disabled = false;
    dom.pauseBtn.textContent = 'PAUSE';

    state.timer.intervalId = setInterval(tick, 1000);
  }

  function tick() {
    state.timer.remainingSeconds -= 1;
    updateTimerDisplay();
    updateRingProgress();
    if (state.timer.remainingSeconds <= 0) {
      completeSession();
    }
  }

  function pauseTimer() {
    if (!state.timer.isRunning) return;
    clearInterval(state.timer.intervalId);
    state.timer.isRunning = false;
    dom.timerCard.classList.remove('timer-active');
    setTimerStateLabel('PAUSED');
    dom.startBtn.disabled = false;
    dom.startBtn.textContent = 'RESUME';
    dom.pauseBtn.disabled = true;
  }

  function resetTimer() {
    clearInterval(state.timer.intervalId);
    state.timer.isRunning = false;
    dom.timerCard.classList.remove('timer-active');

    const minutes = state.timer.presetMinutes === 'custom' ? state.timer.customMinutes : state.timer.presetMinutes;
    state.timer.totalSeconds = minutes * 60;
    state.timer.remainingSeconds = minutes * 60;

    updateTimerDisplay();
    updateRingProgress();
    setTimerStateLabel('READY_');
    setDurationControlsDisabled(false);

    dom.startBtn.disabled = false;
    dom.startBtn.textContent = 'START';
    dom.pauseBtn.disabled = true;
  }

  function completeSession() {
    clearInterval(state.timer.intervalId);
    state.timer.isRunning = false;
    state.timer.remainingSeconds = 0;
    dom.timerCard.classList.remove('timer-active');

    updateTimerDisplay();
    updateRingProgress();
    setTimerStateLabel('SESSION COMPLETE ♡');
    setDurationControlsDisabled(false);
    playCompleteSound();
    spawnCelebration();

    dom.startBtn.disabled = false;
    dom.startBtn.textContent = 'START';
    dom.pauseBtn.disabled = true;

    incrementCompletedSessions();
  }

  function spawnCelebration() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const symbols = ['♡', '✦', '☆'];
    for (let i = 0; i < 6; i++) {
      const particle = document.createElement('span');
      particle.className = 'celebration-particle';
      particle.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      particle.style.left = `${40 + Math.random() * 20}%`;
      particle.style.top = `${45 + Math.random() * 10}%`;
      particle.style.animationDelay = `${i * 0.08}s`;
      dom.timerCard.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove());
    }
  }


  /* ===================================================================
     6. TASKS
  =================================================================== */
  function generateId() {
    return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addTask(rawText) {
    const text = rawText.trim();
    if (!text) return; // guard: ignore empty tasks
    state.tasks.push({ id: generateId(), text, done: false });
    persistTasks();
    renderTasks();
  }

  function toggleTask(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = !task.done;
    persistTasks();
    renderTasks();
    if (task.done) playTaskCompleteSound();
  }

  function deleteTask(id) {
    const itemEl = dom.taskList.querySelector(`[data-id="${id}"]`);
    if (!itemEl) {
      state.tasks = state.tasks.filter((t) => t.id !== id);
      persistTasks();
      renderTasks();
      return;
    }
    // Fade the item out before removing it, so deletion is never jarring or accidental-feeling.
    itemEl.classList.add('leaving');
    setTimeout(() => {
      state.tasks = state.tasks.filter((t) => t.id !== id);
      persistTasks();
      renderTasks();
    }, 260);
  }

  function renderTasks() {
    dom.taskList.innerHTML = '';

    if (state.tasks.length === 0) {
      dom.taskEmptyState.classList.remove('hidden');
    } else {
      dom.taskEmptyState.classList.add('hidden');
    }

    state.tasks.forEach((task) => {
      const li = document.createElement('li');
      li.className = 'task-item' + (task.done ? ' is-done' : '');
      li.dataset.id = task.id;

      const checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.className = 'task-checkbox';
      checkbox.setAttribute('role', 'checkbox');
      checkbox.setAttribute('aria-checked', String(task.done));
      checkbox.setAttribute('aria-label', `Mark "${task.text}" as ${task.done ? 'not done' : 'done'}`);
      checkbox.textContent = task.done ? '✓' : '';
      checkbox.dataset.action = 'toggle';

      const text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = task.text;

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'task-delete';
      deleteBtn.setAttribute('aria-label', `Delete "${task.text}"`);
      deleteBtn.textContent = '×';
      deleteBtn.dataset.action = 'delete';

      li.appendChild(checkbox);
      li.appendChild(text);
      li.appendChild(deleteBtn);
      dom.taskList.appendChild(li);
    });

    const doneCount = state.tasks.filter((t) => t.done).length;
    dom.taskProgress.textContent = `${doneCount} / ${state.tasks.length} DONE`;
  }


  /* ===================================================================
     7. SOUND SYSTEM  (Web Audio API — no external files, no autoplay)
  =================================================================== */
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone({ freq = 440, duration = 0.15, type = 'sine', gain = 0.05, glideTo = null } = {}) {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (glideTo) {
        osc.frequency.exponentialRampToValueAtTime(glideTo, ctx.currentTime + duration);
      }

      gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gainNode).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.02);
    } catch (err) {
      console.warn('FocusFlow: sound playback failed.', err);
    }
  }

  function playClickSound() {
    playTone({ freq: 320, duration: 0.06, type: 'square', gain: 0.03 });
  }
  function playStartSound() {
    playTone({ freq: 480, duration: 0.18, type: 'sine', gain: 0.06, glideTo: 660 });
  }
  function playCompleteSound() {
    playTone({ freq: 660, duration: 0.15, gain: 0.06 });
    setTimeout(() => playTone({ freq: 880, duration: 0.28, gain: 0.05 }), 150);
  }
  function playTaskCompleteSound() {
    playTone({ freq: 920, duration: 0.12, type: 'triangle', gain: 0.05 });
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    persistSettings();
    renderSoundToggle();
    if (state.soundEnabled) playClickSound();
  }

  function renderSoundToggle() {
    dom.soundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
    dom.soundToggle.setAttribute('aria-label', state.soundEnabled ? 'Mute sounds' : 'Unmute sounds');
    dom.soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
  }


  /* ===================================================================
     8. FOCUS MODE
  =================================================================== */
  function enterFocusMode() {
    state.focusModeActive = true;
    document.body.classList.add('focus-mode');
    dom.exitFocusModeBtn.classList.remove('hidden');
    dom.exitFocusModeBtn.focus();
  }

  function exitFocusMode() {
    state.focusModeActive = false;
    document.body.classList.remove('focus-mode');
    dom.exitFocusModeBtn.classList.add('hidden');
    dom.focusModeToggle.focus();
  }


  /* ===================================================================
     9. UI RENDERING
  =================================================================== */
  function renderFocusText() {
    dom.focusDisplay.textContent = state.focusText ? state.focusText : 'nothing set yet ♡';
    dom.focusEditBtn.textContent = state.focusText ? 'EDIT FOCUS' : 'SET FOCUS';
  }

  function renderDailyGoal() {
    dom.goalHearts.innerHTML = '';
    for (let i = 0; i < state.dailyGoal; i++) {
      const heart = document.createElement('span');
      heart.className = 'goal-heart' + (i < state.completedSessions ? ' is-filled' : '');
      heart.textContent = '♡';
      dom.goalHearts.appendChild(heart);
    }
    dom.goalText.textContent = `${state.completedSessions} / ${state.dailyGoal} SESSIONS`;
    dom.goalInput.value = state.dailyGoal;
  }

  function renderSessionCount() {
    dom.sessionCount.textContent = `SESSIONS TODAY: ${state.completedSessions}`;
  }

  function incrementCompletedSessions() {
    const today = todayDateString();
    if (state.lastSessionDate !== today) {
      state.lastSessionDate = today;
      state.completedSessions = 0;
    }
    state.completedSessions += 1;
    persistDailyProgress();
    renderDailyGoal();
    renderSessionCount();
  }

  function setDailyGoal(rawValue) {
    const value = parseInt(rawValue, 10);
    if (!isValidGoal(value)) {
      dom.goalInput.classList.add('is-invalid');
      dom.goalInput.value = state.dailyGoal;
      setTimeout(() => dom.goalInput.classList.remove('is-invalid'), 400);
      return false;
    }
    state.dailyGoal = value;
    persistSettings();
    renderDailyGoal();
    return true;
  }

  function renderAll() {
    updateClock();
    renderFocusText();
    updateTimerDisplay();
    updateRingProgress();
    updateActivePresetUI();
    renderTasks();
    renderDailyGoal();
    renderSessionCount();
    renderSoundToggle();
  }


  /* ===================================================================
     10. EVENT LISTENERS
  =================================================================== */
  function bindEvents() {
    // --- Focus ---
    dom.focusEditBtn.addEventListener('click', () => {
      dom.focusDisplayWrap.classList.add('hidden');
      dom.focusForm.classList.remove('hidden');
      dom.focusInput.value = state.focusText;
      dom.focusInput.focus();
    });

    dom.focusForm.addEventListener('submit', (e) => {
      e.preventDefault();
      state.focusText = dom.focusInput.value.trim();
      persistSettings();
      renderFocusText();
      dom.focusForm.classList.add('hidden');
      dom.focusDisplayWrap.classList.remove('hidden');
    });

    // --- Timer presets ---
    dom.presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const minutes = btn.dataset.minutes === 'custom' ? 'custom' : Number(btn.dataset.minutes);
        setPreset(minutes);
      });
    });
    dom.applyCustomDuration.addEventListener('click', applyCustomDurationValue);
    dom.customDurationInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCustomDurationValue();
      }
    });

    // --- Timer controls ---
    dom.startBtn.addEventListener('click', startTimer);
    dom.pauseBtn.addEventListener('click', pauseTimer);
    dom.resetBtn.addEventListener('click', resetTimer);

    // --- Tasks ---
    dom.taskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addTask(dom.taskInput.value);
      dom.taskInput.value = '';
      dom.taskInput.focus();
    });

    dom.taskList.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const id = target.closest('.task-item').dataset.id;
      if (target.dataset.action === 'toggle') toggleTask(id);
      if (target.dataset.action === 'delete') deleteTask(id);
    });

    // --- Daily goal ---
    dom.goalEditBtn.addEventListener('click', () => {
      dom.goalForm.classList.toggle('hidden');
      if (!dom.goalForm.classList.contains('hidden')) {
        dom.goalInput.value = state.dailyGoal;
        dom.goalInput.focus();
      }
    });
    dom.goalForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (setDailyGoal(dom.goalInput.value)) {
        dom.goalForm.classList.add('hidden');
      }
    });

    // --- Sound ---
    dom.soundToggle.addEventListener('click', toggleSound);

    // --- Focus Mode ---
    dom.focusModeToggle.addEventListener('click', enterFocusMode);
    dom.exitFocusModeBtn.addEventListener('click', exitFocusMode);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.focusModeActive) exitFocusMode();
    });
  }


  /* ===================================================================
     11. INITIALIZATION
  =================================================================== */
  function init() {
    loadState();
    renderAll();
    bindEvents();

    updateClock();
    setInterval(updateClock, 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();