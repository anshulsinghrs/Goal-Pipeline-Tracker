/* ════════════════════════════════════════════════════════════════════
   GOAL PIPELINE · application logic (vanilla JS, no dependencies)
   ────────────────────────────────────────────────────────────────────
   Modules in this file:
     1. Constants & DOM refs
     2. State + localStorage
     3. Goal CRUD
     4. Render — pipeline columns, matrix, progress, counts
     5. Drag & drop (native HTML5)
     6. Modal — open / close / submit
     7. Filters — search, overdue
     8. View toggle — pipeline ↔ matrix
     9. Theme toggle
    10. Reminders + notifications
    11. Import / export / clear
    12. Init & event wiring
   ════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  /* ─── 1. Constants ─────────────────────────────────────────────── */

  const STAGES = [
    { id: 'yearly',  title: 'Yearly',    meta: 'long horizon',     color: 'var(--col-yearly)'  },
    { id: 'monthly', title: 'Monthly',   meta: 'this month',       color: 'var(--col-monthly)' },
    { id: 'weekly',  title: 'Weekly',    meta: 'this week',        color: 'var(--col-weekly)'  },
    { id: 'daily',   title: 'Daily',     meta: 'today',            color: 'var(--col-daily)'   },
    { id: 'done',    title: 'Done',      meta: 'shipped',          color: 'var(--col-done)'    },
  ];

  const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

  const STORAGE_KEY        = 'goalPipeline.goals.v1';
  const SETTINGS_KEY       = 'goalPipeline.settings.v1';
  const REMINDED_KEY       = 'goalPipeline.reminded.v1';
  const REMINDER_INTERVAL  = 30 * 1000;     // every 30 s
  const URGENT_DAYS        = 3;             // ≤ 3 days = urgent for matrix

  /* ─── DOM refs ─────────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    pipeline:        $('#pipelineView'),
    matrix:          $('#matrixView'),
    matrixGrid:      $('.matrix__grid'),
    progressFill:    $('#progressFill'),
    progressPct:     $('#progressPercent'),
    progressFrac:    $('#progressFraction'),
    overdueBtn:      $('#filterOverdueBtn'),
    overdueCount:    $('#overdueCount'),
    themeToggle:     $('#themeToggle'),
    search:          $('#searchInput'),
    addBtn:          $('#addGoalBtn'),
    modalBackdrop:   $('#modalBackdrop'),
    modal:           $('.modal'),
    modalTitle:      $('#modalTitle'),
    modalClose:      $('#modalClose'),
    cancelBtn:       $('#cancelBtn'),
    deleteBtn:       $('#deleteBtn'),
    form:            $('#goalForm'),
    f_id:            $('#goalId'),
    f_title:         $('#goalTitle'),
    f_desc:          $('#goalDescription'),
    f_stage:         $('#goalStage'),
    f_priority:      $('#goalPriority'),
    f_deadline:      $('#goalDeadline'),
    f_reminder:      $('#goalReminder'),
    f_important:     $('#goalImportant'),
    f_urgent:        $('#goalUrgent'),
    toastStack:      $('#toastStack'),
    viewTabs:        document.querySelectorAll('.view-tabs__btn'),
    exportBtn:       $('#exportBtn'),
    importBtn:       $('#importBtn'),
    importInput:     $('#importInput'),
    clearBtn:        $('#clearBtn'),
  };

  /* ─── 2. State & localStorage ─────────────────────────────────── */

  /** @type {Goal[]} — Goal: {id,title,description,stage,priority,deadline,reminder,important,urgent,createdAt,doneAt} */
  let goals = [];
  let settings = {
    theme:    'light',          // 'light' | 'dark'
    view:     'pipeline',       // 'pipeline' | 'matrix'
    overdue:  false,
    search:   '',
  };
  /** Set<id> of goals already reminded — so we don't spam */
  let remindedIds = new Set();

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      goals = raw ? JSON.parse(raw) : [];
      // tolerate older shapes — fill missing fields
      goals = goals.map(g => ({
        important: false,
        urgent: false,
        description: '',
        deadline: '',
        reminder: '',
        createdAt: Date.now(),
        ...g,
      }));
    } catch { goals = []; }

    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) settings = { ...settings, ...JSON.parse(raw) };
    } catch { /* keep defaults */ }

    try {
      const raw = localStorage.getItem(REMINDED_KEY);
      if (raw) remindedIds = new Set(JSON.parse(raw));
    } catch { remindedIds = new Set(); }
  }

  function saveGoals()    { localStorage.setItem(STORAGE_KEY,  JSON.stringify(goals));    }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  function saveReminded() { localStorage.setItem(REMINDED_KEY, JSON.stringify([...remindedIds])); }

  /* ─── 3. Goal CRUD ─────────────────────────────────────────────── */

  const uid = () => 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function createGoal(data) {
    const goal = {
      id: uid(),
      title: data.title.trim(),
      description: (data.description || '').trim(),
      stage: data.stage || 'yearly',
      priority: data.priority || 'medium',
      deadline: data.deadline || '',
      reminder: data.reminder || '',
      important: !!data.important,
      urgent: !!data.urgent,
      createdAt: Date.now(),
      doneAt: null,
    };
    goals.unshift(goal);
    saveGoals();
    return goal;
  }

  function updateGoal(id, patch) {
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) return null;
    const prev = goals[idx];
    const next = { ...prev, ...patch };
    if (patch.stage === 'done' && prev.stage !== 'done') {
      next.doneAt = Date.now();
      // re-arm reminder so it can fire again if undone later
      remindedIds.delete(id);
      saveReminded();
    }
    if (patch.stage && patch.stage !== 'done' && prev.stage === 'done') {
      next.doneAt = null;
    }
    goals[idx] = next;
    saveGoals();
    return next;
  }

  function deleteGoal(id) {
    goals = goals.filter(g => g.id !== id);
    remindedIds.delete(id);
    saveGoals();
    saveReminded();
  }

  /* ─── 4. Helpers — dates, classification, filtering ───────────── */

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T23:59:59');
    if (isNaN(d.getTime())) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
  }

  function isOverdue(goal) {
    if (goal.stage === 'done' || !goal.deadline) return false;
    const days = daysUntil(goal.deadline);
    return days !== null && days < 0;
  }

  function formatDeadline(dateStr) {
    if (!dateStr) return '';
    const days = daysUntil(dateStr);
    if (days === null) return '';
    if (days <  0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'due today';
    if (days === 1) return 'due tomorrow';
    if (days <= 7) return `due in ${days}d`;
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * Decide (important, urgent) for a goal.
   * If user explicitly set them → respect.
   * Otherwise auto-derive from priority + deadline proximity.
   */
  function classifyMatrix(goal) {
    let important = goal.important;
    let urgent    = goal.urgent;

    // auto-derive (only when not explicitly toggled in form)
    if (!important && !urgent) {
      important = goal.priority === 'high' || goal.priority === 'medium';
      const d = daysUntil(goal.deadline);
      urgent = d !== null && d <= URGENT_DAYS;
    }
    return { important: !!important, urgent: !!urgent };
  }

  function passesFilters(goal) {
    if (settings.overdue && !isOverdue(goal)) return false;
    if (settings.search) {
      const hay = (goal.title + ' ' + goal.description).toLowerCase();
      if (!hay.includes(settings.search.toLowerCase())) return false;
    }
    return true;
  }

  /* ─── 5. Render ────────────────────────────────────────────────── */

  /** Render the full pipeline board (5 columns) from scratch. */
  function renderPipeline() {
    els.pipeline.innerHTML = '';
    STAGES.forEach(stage => {
      const stageGoals = goals.filter(g => g.stage === stage.id);
      const visible    = stageGoals.filter(passesFilters);

      const col = document.createElement('section');
      col.className = 'column';
      col.dataset.stage = stage.id;
      col.style.setProperty('--col-color', stage.color);

      col.innerHTML = `
        <header class="column__head">
          <div class="column__head-left">
            <span class="column__chip"></span>
            <h2 class="column__title">${stage.title}</h2>
            <span class="column__count">${stageGoals.length}</span>
          </div>
          <span class="column__meta">${stage.meta}</span>
        </header>
        <div class="column__body" data-dropzone="column"></div>
      `;

      const body = col.querySelector('.column__body');

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'column__empty';
        empty.textContent =
          stageGoals.length === 0
            ? `nothing ${stage.id} yet — drag here or add one`
            : 'no matches for current filters';
        body.appendChild(empty);
      } else {
        visible.forEach(g => body.appendChild(renderCard(g)));
      }

      els.pipeline.appendChild(col);
    });

    wireDropzones();
  }

  /** Render the Eisenhower matrix view (daily goals only). */
  function renderMatrix() {
    els.matrixGrid.querySelectorAll('.quadrant__body').forEach(z => z.innerHTML = '');

    const dailyVisible = goals.filter(g => g.stage === 'daily').filter(passesFilters);

    dailyVisible.forEach(g => {
      const { important, urgent } = classifyMatrix(g);
      const quadKey =
        important && urgent  ? 'do'       :
        important && !urgent ? 'schedule' :
        !important && urgent ? 'delegate' :
                               'drop';
      const zone = els.matrixGrid.querySelector(`.quadrant[data-quadrant="${quadKey}"] .quadrant__body`);
      if (zone) zone.appendChild(renderCard(g));
    });

    // empty hints inside quadrants
    els.matrixGrid.querySelectorAll('.quadrant__body').forEach(z => {
      if (z.children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'column__empty';
        empty.textContent = 'drop here';
        z.appendChild(empty);
      }
    });

    wireDropzones();
  }

  /** Render a single card element (used in both views). */
  function renderCard(goal) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = goal.id;
    card.draggable = true;

    if (isOverdue(goal))     card.classList.add('is-overdue');
    if (goal.stage === 'done') card.classList.add('is-done');

    // priority colour vars driven by data-attribute
    const pColors = {
      high:   { c: 'var(--p-high)',   bg: 'var(--p-high-bg)' },
      medium: { c: 'var(--p-med)',    bg: 'var(--p-med-bg)'  },
      low:    { c: 'var(--p-low)',    bg: 'var(--p-low-bg)'  },
    };
    const pc = pColors[goal.priority] || pColors.medium;
    card.style.setProperty('--card-accent', pc.c);
    card.style.setProperty('--p-color', pc.c);
    card.style.setProperty('--p-bg', pc.bg);

    const days = daysUntil(goal.deadline);
    const deadlineClass =
      days === null ? '' :
      days <  0     ? 'card__meta-item--overdue' :
      days <= 2     ? 'card__meta-item--soon' : '';

    const stageTitle = STAGES.find(s => s.id === goal.stage)?.title || '';

    card.innerHTML = `
      <div class="card__top">
        <h3 class="card__title">${escapeHtml(goal.title)}</h3>
        <span class="card__priority">${PRIORITY_LABELS[goal.priority] || ''}</span>
      </div>
      ${goal.description ? `<p class="card__desc">${escapeHtml(goal.description)}</p>` : ''}
      <div class="card__meta">
        ${goal.deadline ? `
          <span class="card__meta-item ${deadlineClass}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            ${formatDeadline(goal.deadline)}
          </span>` : ''}
        ${goal.reminder ? `
          <span class="card__meta-item" title="Reminder set">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>
            </svg>
          </span>` : ''}
        <span class="card__tag">${stageTitle}</span>
      </div>
      <div class="card__actions">
        ${goal.stage !== 'done' ? `
          <button class="card__action-btn card__action-btn--done" data-act="done" type="button" aria-label="Mark done" title="Mark done">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </button>` : `
          <button class="card__action-btn" data-act="undone" type="button" aria-label="Move back to daily" title="Reopen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
          </button>`}
        <button class="card__action-btn" data-act="edit" type="button" aria-label="Edit" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="card__action-btn card__action-btn--delete" data-act="delete" type="button" aria-label="Delete" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    `;

    // ── card events ──────────────────────────────────────────
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) {
        // tapping the card body (outside actions) opens edit
        if (!e.target.closest('.card__actions')) openModal(goal.id);
        return;
      }
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'edit')    openModal(goal.id);
      if (act === 'delete')  handleDelete(goal.id);
      if (act === 'done')    moveGoal(goal.id, 'done');
      if (act === 'undone')  moveGoal(goal.id, 'daily');
    });

    // ── HTML5 drag ───────────────────────────────────────────
    card.addEventListener('dragstart', (e) => {
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', goal.id);
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));

    return card;
  }

  /** Update progress bar + counts + overdue badge — call after any state change. */
  function renderStats() {
    const total = goals.length;
    const done  = goals.filter(g => g.stage === 'done').length;
    const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

    els.progressFill.style.width = pct + '%';
    els.progressPct.textContent  = pct;
    els.progressFrac.textContent = `${done}/${total}`;

    const overdueN = goals.filter(isOverdue).length;
    if (overdueN > 0) {
      els.overdueCount.hidden = false;
      els.overdueCount.textContent = overdueN;
    } else {
      els.overdueCount.hidden = true;
    }
  }

  /** One render entry-point — keeps things consistent. */
  function render() {
    if (settings.view === 'matrix') {
      els.pipeline.hidden = true;
      els.matrix.hidden   = false;
      renderMatrix();
    } else {
      els.pipeline.hidden = false;
      els.matrix.hidden   = true;
      renderPipeline();
    }
    renderStats();
  }

  function escapeHtml(str) {
    const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  }

  /* ─── 6. Drag & drop ───────────────────────────────────────────── */

  function wireDropzones() {
    document.querySelectorAll('[data-dropzone]').forEach(zone => {
      const isQuadrant = zone.dataset.dropzone === 'quadrant';
      const targetEl   = isQuadrant ? zone.closest('.quadrant') : zone.closest('.column');

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        targetEl.classList.add('is-drop-target');
      });
      zone.addEventListener('dragleave', (e) => {
        // only clear when actually leaving the zone (not entering a child)
        if (!zone.contains(e.relatedTarget)) targetEl.classList.remove('is-drop-target');
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        targetEl.classList.remove('is-drop-target');
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;

        if (isQuadrant) {
          // Matrix drop → set important/urgent flags + keep stage = daily
          const q = targetEl.dataset.quadrant;
          const important = q === 'do' || q === 'schedule';
          const urgent    = q === 'do' || q === 'delegate';
          updateGoal(id, { important, urgent, stage: 'daily' });
        } else {
          // Pipeline drop → change stage
          const newStage = targetEl.dataset.stage;
          moveGoal(id, newStage);
        }
        render();
      });
    });
  }

  function moveGoal(id, stage) {
    const goal = goals.find(g => g.id === id);
    if (!goal || goal.stage === stage) { render(); return; }
    updateGoal(id, { stage });
    if (stage === 'done') showToast({ title: 'Shipped ✓', text: goal.title, type: 'success' });
    render();
  }

  /* ─── 7. Modal ─────────────────────────────────────────────────── */

  function openModal(id = null) {
    if (id) {
      const g = goals.find(x => x.id === id);
      if (!g) return;
      els.modalTitle.textContent = 'Edit goal';
      els.f_id.value         = g.id;
      els.f_title.value      = g.title;
      els.f_desc.value       = g.description;
      els.f_stage.value      = g.stage;
      els.f_priority.value   = g.priority;
      els.f_deadline.value   = g.deadline;
      els.f_reminder.value   = g.reminder;
      els.f_important.checked = g.important;
      els.f_urgent.checked   = g.urgent;
      els.deleteBtn.hidden   = false;
    } else {
      els.modalTitle.textContent = 'New goal';
      els.form.reset();
      els.f_id.value = '';
      // sensible defaults for a brand-new goal
      els.f_priority.value = 'medium';
      els.f_stage.value = settings.view === 'matrix' ? 'daily' : 'yearly';
      els.deleteBtn.hidden = true;
    }
    els.modalBackdrop.hidden = false;
    setTimeout(() => els.f_title.focus(), 50);
  }

  function closeModal() {
    els.modalBackdrop.hidden = true;
    els.form.reset();
  }

  function handleSubmit(e) {
    e.preventDefault();
    const data = {
      title:       els.f_title.value,
      description: els.f_desc.value,
      stage:       els.f_stage.value,
      priority:    els.f_priority.value,
      deadline:    els.f_deadline.value,
      reminder:    els.f_reminder.value,
      important:   els.f_important.checked,
      urgent:      els.f_urgent.checked,
    };
    if (!data.title.trim()) { els.f_title.focus(); return; }

    const id = els.f_id.value;
    if (id) updateGoal(id, data);
    else    createGoal(data);

    closeModal();
    render();
    requestNotificationPermission();
  }

  function handleDelete(id) {
    const g = goals.find(x => x.id === id);
    if (!g) return;
    if (!confirm(`Delete "${g.title}"? This can't be undone.`)) return;
    deleteGoal(id);
    if (els.f_id.value === id) closeModal();
    render();
  }

  /* ─── 8. Filters & view ────────────────────────────────────────── */

  function setSearch(q) {
    settings.search = q;
    saveSettings();
    render();
  }

  function toggleOverdueFilter() {
    settings.overdue = !settings.overdue;
    els.overdueBtn.setAttribute('aria-pressed', settings.overdue);
    saveSettings();
    render();
  }

  function setView(view) {
    settings.view = view;
    els.viewTabs.forEach(t => {
      const active = t.dataset.view === view;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active);
    });
    saveSettings();
    render();
  }

  /* ─── 9. Theme ─────────────────────────────────────────────────── */

  function applyTheme(theme) {
    settings.theme = theme;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#14130f' : '#f7f4ee');
    saveSettings();
  }

  function toggleTheme() {
    applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
  }

  /* ─── 10. Reminders ────────────────────────────────────────────── */

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  function checkReminders() {
    const now = Date.now();
    goals.forEach(g => {
      if (g.stage === 'done' || !g.reminder || remindedIds.has(g.id)) return;
      const t = new Date(g.reminder).getTime();
      if (isNaN(t) || t > now) return;
      // fire reminder
      remindedIds.add(g.id);
      saveReminded();
      showToast({
        title: 'Reminder · ' + g.title,
        text:  g.description || formatDeadline(g.deadline) || 'Time to act on this goal.',
        type:  'reminder',
      });
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Goal Pipeline · ' + g.title, {
          body: g.description || 'Reminder',
          tag:  g.id,
        });
      }
    });
  }

  /* ─── 11. Toasts ───────────────────────────────────────────────── */

  function showToast({ title, text, type = 'reminder', duration = 6000 }) {
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.innerHTML = `
      <div class="toast__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${type === 'success'
            ? '<path d="M20 6 9 17l-5-5"/>'
            : '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'}
        </svg>
      </div>
      <div class="toast__body">
        <div class="toast__title">${escapeHtml(title)}</div>
        ${text ? `<div class="toast__text">${escapeHtml(text)}</div>` : ''}
      </div>
      <button class="toast__close" type="button" aria-label="Dismiss">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    `;
    t.querySelector('.toast__close').addEventListener('click', () => t.remove());
    els.toastStack.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; }, duration - 300);
    setTimeout(() => t.remove(), duration);
  }

  /* ─── 12. Import / Export / Clear ──────────────────────────────── */

  function exportJSON() {
    const blob = new Blob([JSON.stringify(goals, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `goal-pipeline-${d}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast({ title: 'Exported', text: 'Your goals are saved as JSON.', type: 'success' });
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error('Invalid format');
        goals = parsed.filter(g => g && g.id && g.title);
        saveGoals();
        render();
        showToast({ title: 'Imported', text: `${goals.length} goals loaded.`, type: 'success' });
      } catch {
        showToast({ title: 'Import failed', text: 'File must be a JSON export.', type: 'reminder' });
      }
    };
    reader.readAsText(file);
  }

  function clearAll() {
    if (!confirm('Delete ALL goals? This cannot be undone.')) return;
    goals = [];
    remindedIds.clear();
    saveGoals();
    saveReminded();
    render();
  }

  /* ─── 13. Init & event wiring ──────────────────────────────────── */

  function wireEvents() {
    // header
    els.themeToggle .addEventListener('click', toggleTheme);
    els.overdueBtn  .addEventListener('click', toggleOverdueFilter);
    els.search      .addEventListener('input', e => setSearch(e.target.value));
    els.viewTabs.forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));

    // FAB + modal
    els.addBtn      .addEventListener('click', () => openModal());
    els.modalClose  .addEventListener('click', closeModal);
    els.cancelBtn   .addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', e => {
      if (e.target === els.modalBackdrop) closeModal();
    });
    els.deleteBtn   .addEventListener('click', () => handleDelete(els.f_id.value));
    els.form        .addEventListener('submit', handleSubmit);

    // footer utilities
    els.exportBtn   .addEventListener('click', exportJSON);
    els.importBtn   .addEventListener('click', () => els.importInput.click());
    els.importInput .addEventListener('change', e => e.target.files[0] && importJSON(e.target.files[0]));
    els.clearBtn    .addEventListener('click', clearAll);

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // ignore typing in inputs (except Escape)
      const typing = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

      if (e.key === 'Escape') {
        if (!els.modalBackdrop.hidden) closeModal();
        return;
      }
      if (typing) return;

      if (e.key === '/') { e.preventDefault(); els.search.focus(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openModal(); }
      if (e.key === 'd' || e.key === 'D') { toggleTheme(); }
      if (e.key === '1') setView('pipeline');
      if (e.key === '2') setView('matrix');
    });
  }

  function init() {
    loadAll();
    applyTheme(settings.theme);
    setView(settings.view);
    els.overdueBtn.setAttribute('aria-pressed', settings.overdue);
    els.search.value = settings.search || '';

    // first-time experience: seed a couple of example goals
    if (goals.length === 0) seedExamples();

    wireEvents();
    render();

    // reminder loop
    checkReminders();
    setInterval(checkReminders, REMINDER_INTERVAL);
  }

  /** Seed friendly examples on first run so the board isn't empty. */
  function seedExamples() {
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const plus = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return fmt(d); };

    [
      { stage: 'yearly',  title: 'Run a half-marathon',           priority: 'medium', deadline: plus(180), description: 'Sustained training, not a sprint.' },
      { stage: 'monthly', title: 'Ship portfolio v2',             priority: 'high',   deadline: plus(20),  description: 'Three case studies, real screenshots.' },
      { stage: 'weekly',  title: 'Outline case-study #1',         priority: 'high',   deadline: plus(4) },
      { stage: 'daily',   title: 'Draft hero copy',               priority: 'high',   deadline: plus(0),   important: true, urgent: true },
      { stage: 'daily',   title: 'Read for 30 minutes',           priority: 'low',    deadline: plus(0),   important: true, urgent: false },
      { stage: 'done',    title: 'Set up project repository',     priority: 'medium' },
    ].forEach(createGoal);
  }

  // GO
  document.addEventListener('DOMContentLoaded', init);
})();
