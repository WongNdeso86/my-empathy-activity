const START_DATE = new Date('2026-02-19T00:00:00');
const RAMADAN_DAYS = 30;
const STORAGE_KEY = 'ramadan-tracker-v1';
const DB_NAME = 'ramadan_tracker_db';
const STORE = 'state';

const viaClasses = {
  1: [['07:30', '09:10'], ['11:10', '12:50'], ['14:50', '16:30']],
  2: [['11:10', '12:50'], ['13:00', '15:30']],
  3: [['07:30', '09:10'], ['10:10', '12:40'], ['14:50', '16:30']],
  4: [['07:30', '09:00'], ['11:10', '12:50']]
};
const fendiClasses = {
  2: [['10:00', '13:00']],
  3: [['10:00', '18:00']]
};

let surahData = [];
let juzBoundaries = [];
let state = { days: {} };
let scheduleDays = [];

const $ = (sel) => document.querySelector(sel);
const saveStatus = $('#saveStatus');

init();

async function init() {
  [surahData, juzBoundaries] = await Promise.all([
    fetch('assets/quran_surah.json').then(r => r.json()),
    fetch('assets/quran_juz_boundaries.json').then(r => r.json())
  ]);

  scheduleDays = buildRamadanSchedule();
  state = await loadState() || buildInitialState(scheduleDays);

  bindTabs();
  bindGlobalButtons();
  renderSchedule();
  renderTracker();
  renderStats();
  renderHomeSummary();
  ensureTodayExists();
}

function buildRamadanSchedule() {
  const days = [];
  for (let i = 0; i < RAMADAN_DAYS; i++) {
    const date = new Date(START_DATE);
    date.setDate(START_DATE.getDate() + i);
    const dow = date.getDay();
    const isWeekend = [5, 6, 0].includes(dow);
    const sessionsTemplate = isWeekend
      ? [['09:00', '10:30'], ['13:30', '15:00'], ['16:00', '17:30']]
      : [['09:00', '10:15'], ['20:00', '21:15']];

    const blocks = [
      { type: 'sleep', label: 'Tidur habis Subuh', start: '05:15', end: '07:15' },
      ...toBlocks(viaClasses[dow] || [], 'via', 'Kelas Via'),
      ...toBlocks(fendiClasses[dow] || [], 'fendi', 'Kelas Fendi')
    ];

    if (isWeekend) {
      blocks.push({ type: 'weekend', label: 'Buka–Tidur', start: '18:00', end: '22:30' });
    }

    const khatam = sessionsTemplate.map(([start, end], idx) => {
      const shifted = shiftIfConflict({ start, end }, blocks, 6);
      const block = {
        type: 'khatam',
        label: `Khatam Bareng Sesi ${idx + 1}`,
        start: shifted.start,
        end: shifted.end
      };
      blocks.push(block);
      return block;
    });

    days.push({
      day: i + 1,
      dateISO: date.toISOString(),
      isWeekend,
      targetJuz: isWeekend ? 3 : 1,
      blocks: blocks.sort((a, b) => timeToMin(a.start) - timeToMin(b.start)),
      sessions: khatam
    });
  }
  return days;
}

function toBlocks(slots, type, label) {
  return slots.map(([start, end], i) => ({ type, label: `${label} ${i + 1}`, start, end }));
}

function shiftIfConflict(session, blocks, maxShiftSteps = 6) {
  let start = timeToMin(session.start);
  let end = timeToMin(session.end);
  for (let step = 0; step <= maxShiftSteps; step++) {
    const conflict = blocks.some(b => intersects(start, end, timeToMin(b.start), timeToMin(b.end)));
    if (!conflict) return { start: minToTime(start), end: minToTime(end) };
    start += 30;
    end += 30;
  }
  return { start: minToTime(start), end: minToTime(end) };
}

function intersects(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

function buildInitialState(schedule) {
  const days = {};
  schedule.forEach(d => {
    days[d.day] = {
      sessions: d.sessions.map(s => ({
        plannedStart: s.start,
        plannedEnd: s.end,
        actualStart: '',
        actualEnd: '',
        durationMin: 0,
        surahStart: '',
        ayatStart: '',
        surahEnd: '',
        ayatEnd: '',
        juzStart: '',
        juzEnd: '',
        uniqueJuz: [],
        type: 'Bareng (Via + Fendi)'
      }))
    };
  });
  return { days, savedAt: '' };
}

function ensureTodayExists() {
  const today = getRamadanDayNumber(new Date());
  if (today > 0 && !state.days[today]) {
    const sched = scheduleDays[today - 1];
    state.days[today] = buildInitialState([sched]).days[today];
  }
}

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function renderSchedule() {
  const root = $('#scheduleContainer');
  root.innerHTML = '';
  scheduleDays.forEach(day => {
    const card = document.createElement('article');
    card.className = 'card day-card';
    card.innerHTML = `<h3>Day ${day.day} • ${formatDate(day.dateISO)} • Target ${day.targetJuz} juz</h3>`;
    const timeline = document.createElement('div');
    timeline.className = 'timeline';
    day.blocks.forEach(b => {
      const div = document.createElement('div');
      div.className = `block ${b.type}`;
      div.innerHTML = `<span>${b.label}</span><strong>${b.start}–${b.end}</strong>`;
      timeline.appendChild(div);
    });
    const small = document.createElement('p');
    small.className = 'small';
    small.textContent = 'Timeline ditampilkan dari 05:00 sampai 24:00.';
    card.append(timeline, small);
    root.appendChild(card);
  });
}

function renderTracker() {
  const root = $('#trackerContainer');
  const datalist = `<datalist id="surahList">${surahData.map(s => `<option value="${s.name}"></option>`).join('')}</datalist>`;
  root.innerHTML = datalist;

  scheduleDays.forEach(day => {
    const dayState = state.days[day.day];
    const section = document.createElement('section');
    section.className = 'card tracker-day';
    section.innerHTML = `<h3>Day ${day.day} • ${formatDate(day.dateISO)} ${day.isWeekend ? '(Weekend: 3 sesi)' : '(Weekday: 2 sesi)'}</h3>`;

    dayState.sessions.forEach((session, idx) => {
      const card = document.createElement('div');
      card.className = 'session-card';
      card.innerHTML = `
        <strong>Sesi ${idx + 1} — ${session.type}</strong>
        <p class="small">Planned time: ${session.plannedStart}–${session.plannedEnd}</p>
        <div class="button-row">
          <button class="btn" data-action="start" data-day="${day.day}" data-session="${idx}">Mulai sesi</button>
          <button class="btn btn-secondary" data-action="end" data-day="${day.day}" data-session="${idx}">Akhiri sesi</button>
          <button class="btn btn-secondary" data-action="delete" data-day="${day.day}" data-session="${idx}">Delete entry</button>
        </div>
        <div class="session-grid">
          ${inputField('Actual Start', 'actualStart', session.actualStart, true)}
          ${inputField('Actual End', 'actualEnd', session.actualEnd, true)}
          ${inputField('Durasi (menit)', 'durationMin', session.durationMin || '', true)}
          ${inputField('Surah start', 'surahStart', session.surahStart, false, 'surahList')}
          ${inputField('Ayat start', 'ayatStart', session.ayatStart, false)}
          ${inputField('Surah end', 'surahEnd', session.surahEnd, false, 'surahList')}
          ${inputField('Ayat end', 'ayatEnd', session.ayatEnd, false)}
          ${inputField('Juz start', 'juzStart', session.juzStart, true)}
          ${inputField('Juz end', 'juzEnd', session.juzEnd, true)}
        </div>
        <p class="small">Unique juz sesi ini: ${(session.uniqueJuz || []).join(', ') || '-'}</p>
      `;
      section.appendChild(card);
    });

    root.appendChild(section);
  });

  root.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', onSessionAction);
  });

  root.querySelectorAll('input[data-field]').forEach(input => {
    if (input.readOnly) return;
    input.addEventListener('input', onProgressInput);
  });
}

function inputField(label, field, value, readOnly = false, list = '') {
  return `<label>${label}<input ${list ? `list="${list}"` : ''} data-field="${field}" value="${value ?? ''}" ${readOnly ? 'readonly' : ''}></label>`;
}

function onSessionAction(e) {
  const day = Number(e.target.dataset.day);
  const idx = Number(e.target.dataset.session);
  const action = e.target.dataset.action;
  const session = state.days[day].sessions[idx];
  const now = new Date();

  if (action === 'start') session.actualStart = formatTime(now);
  if (action === 'end') session.actualEnd = formatTime(now);
  if (action === 'delete') {
    const keep = { plannedStart: session.plannedStart, plannedEnd: session.plannedEnd, type: session.type };
    state.days[day].sessions[idx] = { ...buildInitialState([{ day, sessions: [{ start: keep.plannedStart, end: keep.plannedEnd }] }]).days[day].sessions[0], ...keep };
  }

  if (session.actualStart && session.actualEnd) {
    session.durationMin = Math.max(0, timeToMin(session.actualEnd) - timeToMin(session.actualStart));
  }

  persistAndRerender();
}

function onProgressInput(e) {
  const card = e.target.closest('.session-card');
  const day = Number(card.querySelector('button').dataset.day);
  const idx = Number(card.querySelector('button').dataset.session);
  const inputs = card.querySelectorAll('input[data-field]');
  const session = state.days[day].sessions[idx];

  inputs.forEach(inp => {
    if (!inp.readOnly) session[inp.dataset.field] = inp.value.trim();
  });

  validateAndComputeJuz(session);
  persistAndRerender(false);
}

function validateAndComputeJuz(session) {
  const sStart = findSurah(session.surahStart);
  const sEnd = findSurah(session.surahEnd);
  if (!sStart || !sEnd) return;

  const ayatStart = Number(session.ayatStart);
  const ayatEnd = Number(session.ayatEnd);
  if (ayatStart < 1 || ayatStart > sStart.ayahCount) return;
  if (ayatEnd < 1 || ayatEnd > sEnd.ayahCount) return;

  const posStart = globalPos(sStart.number, ayatStart);
  const posEnd = globalPos(sEnd.number, ayatEnd);
  const startPos = Math.min(posStart, posEnd);
  const endPos = Math.max(posStart, posEnd);
  const juzStart = getJuzForPos(startPos);
  const juzEnd = getJuzForPos(endPos);
  const unique = [];
  for (let j = juzStart; j <= juzEnd; j++) unique.push(j);

  session.juzStart = juzStart;
  session.juzEnd = juzEnd;
  session.uniqueJuz = unique;
}

function findSurah(name) {
  return surahData.find(s => s.name.toLowerCase() === String(name).toLowerCase());
}

function globalPos(surahNum, ayah) {
  let total = 0;
  for (let i = 0; i < surahNum - 1; i++) total += surahData[i].ayahCount;
  return total + ayah;
}

function getJuzForPos(pos) {
  const starts = juzBoundaries.map(j => globalPos(j.surah, j.ayah));
  let juz = 1;
  for (let i = 0; i < starts.length; i++) {
    if (pos >= starts[i]) juz = i + 1;
  }
  return juz;
}

function renderHomeSummary() {
  const dayNum = getRamadanDayNumber(new Date());
  $('#ramadanDay').textContent = dayNum > 0 ? `Day ${Math.min(dayNum, RAMADAN_DAYS)}` : 'Belum mulai';

  const completed = allSessions().filter(s => s.surahEnd && s.ayatEnd);
  const last = completed[completed.length - 1];
  $('#lastProgress').textContent = last ? `Juz ${last.juzEnd || '-'} • ${last.surahEnd}:${last.ayatEnd}` : 'Belum ada progress';

  const allJuz = new Set(allSessions().flatMap(s => s.uniqueJuz || []));
  $('#uniqueJuzSummary').textContent = `${allJuz.size}/30`;
  $('#juzProgressBar').style.width = `${(allJuz.size / 30) * 100}%`;

  saveStatus.textContent = state.savedAt ? `Saved ✓ ${state.savedAt}` : 'Belum tersimpan';
}

function renderStats() {
  const sessions = allSessions();
  const done = sessions.filter(s => s.actualStart && s.actualEnd);
  const totalDur = done.reduce((a, b) => a + (Number(b.durationMin) || 0), 0);
  const uniqueJuz = new Set(sessions.flatMap(s => s.uniqueJuz || []));
  const lastJuz = [...sessions].reverse().find(s => s.juzEnd)?.juzEnd || '-';

  const streak = calcStreak();
  const cards = [
    ['Total sesi selesai', done.length],
    ['Total durasi', `${totalDur} menit`],
    ['Unique juz tersentuh', `${uniqueJuz.size}/30`],
    ['Terakhir sampai juz', lastJuz],
    ['Streak hari ngaji', `${streak} hari`]
  ];

  $('#statsCards').innerHTML = cards.map(([k, v]) => `<article class="stat"><p>${k}</p><h3>${v}</h3></article>`).join('');
  drawChart();
}

function calcStreak() {
  let streak = 0;
  for (let d = RAMADAN_DAYS; d >= 1; d--) {
    const daySessions = state.days[d]?.sessions || [];
    const has = daySessions.some(s => s.actualStart && s.actualEnd);
    if (has) streak++; else if (streak > 0) break;
  }
  return streak;
}

function drawChart() {
  const canvas = $('#statsChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 180 * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  const width = canvas.clientWidth;
  const height = 180;

  const max = 3;
  scheduleDays.forEach((d, i) => {
    const x = i * (width / RAMADAN_DAYS);
    const barW = Math.max(4, (width / RAMADAN_DAYS) - 2);
    const actual = (state.days[d.day]?.sessions || []).filter(s => s.actualStart && s.actualEnd).length;
    const targetH = (d.sessions.length / max) * (height - 30);
    const actualH = (actual / max) * (height - 30);

    ctx.fillStyle = '#334155';
    ctx.fillRect(x, height - targetH, barW, targetH);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x, height - actualH, barW, actualH);
  });
}

function bindGlobalButtons() {
  $('#printScheduleBtn').addEventListener('click', () => {
    activateTab('jadwal');
    window.print();
  });
  $('#printStatsBtn').addEventListener('click', () => {
    activateTab('stats');
    window.print();
  });

  $('#exportJsonBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ramadan-backup-${Date.now()}.json`;
    a.click();
  });

  $('#importJsonInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (!data.days) return alert('Format JSON tidak valid');
    state = data;
    await persistAndRerender();
  });

  $('#downloadPngBtn').addEventListener('click', downloadTodayPNG);
}

async function downloadTodayPNG() {
  const day = Math.min(Math.max(getRamadanDayNumber(new Date()), 1), RAMADAN_DAYS);
  const sessions = state.days[day]?.sessions || [];
  const lines = sessions.map((s, i) => `Sesi ${i + 1} | Planned ${s.plannedStart}-${s.plannedEnd} | Actual ${s.actualStart || '-'}-${s.actualEnd || '-'} | ${s.durationMin || 0}m | ${s.surahStart || '-'}:${s.ayatStart || '-'} → ${s.surahEnd || '-'}:${s.ayatEnd || '-'} | Juz ${s.juzStart || '-'}-${s.juzEnd || '-'}`);

  const card = document.createElement('div');
  card.className = 'share-card';
  card.innerHTML = `
    <h1>Ramadan Day ${day}</h1>
    <p>${formatDate(scheduleDays[day - 1].dateISO)} • Via + Fendi</p>
    <hr>
    ${lines.map(l => `<p>${l}</p>`).join('')}
  `;
  document.body.appendChild(card);

  const canvas = await html2canvas(card, { backgroundColor: '#0f172a', scale: 2 });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `ramadan-day-${day}.png`;
  a.click();
  card.remove();
}

function activateTab(tab) {
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).click();
}

function allSessions() {
  return Object.values(state.days).flatMap(d => d.sessions || []);
}

async function persistAndRerender(full = true) {
  state.savedAt = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  await saveState(state);
  if (full) {
    renderTracker();
    renderStats();
  }
  renderHomeSummary();
}

function getRamadanDayNumber(date) {
  const diff = Math.floor((new Date(date.toDateString()) - START_DATE) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(n) {
  const h = String(Math.floor(n / 60)).padStart(2, '0');
  const m = String(n % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function formatTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveState(data) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, 'state');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

async function loadState() {
  try {
    const db = await openDB();
    const fromDB = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('state');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (fromDB) return fromDB;
  } catch {}

  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
