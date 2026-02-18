const START_DATE = new Date('2026-02-19T00:00:00');
const RAMADAN_DAYS = 30;
const STORAGE_KEY = 'ramadan-tracker-v2';
const DB_NAME = 'ramadan_tracker_db';
const STORE = 'state';

const viaClasses = {
  1: [['07:30', '09:10'], ['11:10', '12:50'], ['14:50', '16:30']],
  2: [['11:10', '12:50'], ['13:00', '15:30']],
  3: [['07:30', '09:10'], ['10:10', '12:40'], ['14:50', '16:30']],
  4: [['07:30', '09:00'], ['11:10', '12:50']]
};
const fendiClasses = { 2: [['10:00', '13:00']], 3: [['10:00', '18:00']] };

let surahData = [];
let juzBoundaries = [];
let scheduleDays = [];
let state = { days: {}, history: [], savedAt: '' };

const $ = (sel) => document.querySelector(sel);
const saveStatusEl = $('#saveStatus');

init();

async function init() {
  [surahData, juzBoundaries] = await Promise.all([
    fetch('assets/quran_surah.json').then(r => r.json()),
    fetch('assets/quran_juz_boundaries.json').then(r => r.json())
  ]);

  scheduleDays = buildRamadanSchedule();
  state = (await loadState()) || buildInitialState(scheduleDays);

  bindTabs();
  bindGlobalButtons();
  renderSchedule();
  renderSchedule();
  renderTrackerToday();
  renderHistory();
  renderStats();
  renderHomeSummary();
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

    if (isWeekend) blocks.push({ type: 'weekend', label: 'Buka–Tidur', start: '18:00', end: '22:30' });

    const khatam = sessionsTemplate.map(([start, end], idx) => {
      const shifted = shiftIfConflict({ start, end }, blocks, 6);
      const block = { type: 'khatam', label: `Khatam Bareng Sesi ${idx + 1}`, start: shifted.start, end: shifted.end };
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
    const conflict = blocks.some(b => start < timeToMin(b.end) && timeToMin(b.start) < end);
    if (!conflict) return { start: minToTime(start), end: minToTime(end) };
    start += 30;
    end += 30;
  }
  return { start: minToTime(start), end: minToTime(end) };
}

function buildInitialState(schedule) {
  const days = {};
  schedule.forEach(d => {
    days[d.day] = {
      sessions: d.sessions.map(s => ({
        plannedStart: s.start,
        plannedEnd: s.end,
        trackDateISO: d.dateISO,
        actualStart: s.start,
        actualEnd: s.end,
        durationMin: Math.max(0, timeToMin(s.end) - timeToMin(s.start)),
        surahStart: '', ayatStart: '', surahEnd: '', ayatEnd: '',
        juzStart: '', juzEnd: '', uniqueJuz: [],
        type: 'Bareng (Via + Fendi)',
        trackedAt: ''
      }))
    };
  });
  return { days, history: [], savedAt: '' };
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

    const dayActuals = state.history
      .filter(h => h.day === day.day)
      .sort((a, b) => a.sessionIndex - b.sessionIndex);
    dayActuals.forEach(a => {
      const div = document.createElement('div');
      div.className = 'block actual';
      div.innerHTML = `<span>Pelaksanaan Sesi ${a.sessionIndex + 1}</span><strong>${a.actualStart}–${a.actualEnd}</strong>`;
      timeline.appendChild(div);
    });

    card.append(timeline);
    root.appendChild(card);
  });
}

function renderTrackerToday() {
  const root = $('#trackerContainer');
  const today = clampDay(getRamadanDayNumber(new Date()));
  const sched = scheduleDays[today - 1];
  const dayState = state.days[today];

  root.innerHTML = `<datalist id="surahList">${surahData.map(s => `<option value="${s.name}"></option>`).join('')}</datalist>`;

  const section = document.createElement('section');
  section.className = 'card tracker-day';
  section.innerHTML = `
    <h3>Tracker Hari Ini — Day ${today}</h3>
    <p class="small">Tanggal: ${formatDate(sched.dateISO)} • Sesi otomatis: ${sched.sessions.length} • Jam otomatis sesuai jadwal.</p>
  `;

  dayState.sessions.forEach((session, idx) => {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <strong>Sesi ${idx + 1} — ${session.type}</strong>
      <p class="small">Tanggal otomatis: ${formatDate(session.trackDateISO)}</p>
      <p class="small">Jadwal: ${session.plannedStart}–${session.plannedEnd} (durasi rencana ${session.durationMin} menit)</p>
      <label>Jam mulai pelaksanaan (otomatis end by durasi rencana)
        <input data-day="${today}" data-session="${idx}" data-field="actualStart" value="${session.actualStart}" placeholder="contoh: 09:00">
      </label>
      <p class="small">Pelaksanaan (hasil): ${session.actualStart}–${session.actualEnd}</p>
      <div class="session-grid">
        ${inputField('Surah start', 'surahStart', session.surahStart, false, 'surahList', today, idx)}
        ${inputField('Ayat start', 'ayatStart', session.ayatStart, false, '', today, idx)}
        ${inputField('Surah end', 'surahEnd', session.surahEnd, false, 'surahList', today, idx)}
        ${inputField('Ayat end', 'ayatEnd', session.ayatEnd, false, '', today, idx)}
        ${inputField('Juz start', 'juzStart', session.juzStart, true, '', today, idx)}
        ${inputField('Juz end', 'juzEnd', session.juzEnd, true, '', today, idx)}
      </div>
      <div class="button-row">
        <button class="btn" data-action="save-track" data-day="${today}" data-session="${idx}">Simpan tracking</button>
      </div>
      <p class="small">Tracked at: ${session.trackedAt || '-'}</p>
      <p class="small">Unique juz sesi ini: ${(session.uniqueJuz || []).join(', ') || '-'}</p>
    `;
    section.appendChild(card);
  });

  root.appendChild(section);
  root.querySelectorAll('input[data-field]').forEach(inp => {
    if (!inp.readOnly) inp.addEventListener('input', onProgressInput);
  });
  root.querySelectorAll('button[data-action="save-track"]').forEach(btn => btn.addEventListener('click', onSaveTrack));
}

function renderHistory() {
  const root = $('#historyContainer');
  const sorted = [...state.history].sort((a, b) => new Date(b.trackedAtISO) - new Date(a.trackedAtISO));
  if (!sorted.length) {
    root.innerHTML = `<section class="card"><h3>Belum ada histori tracking</h3><p class="small">Simpan progress di tab Tracker, maka histori akan muncul di sini.</p></section>`;
    return;
  }

  root.innerHTML = sorted.map(item => `
    <section class="card">
      <h3>Day ${item.day} • ${formatDate(item.trackDateISO)} • Sesi ${item.sessionIndex + 1}</h3>
      <p class="small">Jam: ${item.actualStart}-${item.actualEnd} • Durasi: ${item.durationMin} menit</p>
      <p class="small">Progress: ${item.surahStart}:${item.ayatStart} → ${item.surahEnd}:${item.ayatEnd}</p>
      <p class="small">Juz: ${item.juzStart}-${item.juzEnd} • Unique: ${(item.uniqueJuz || []).join(', ') || '-'}</p>
      <p class="small">Disimpan: ${new Date(item.trackedAtISO).toLocaleString('id-ID')}</p>
      <button class="btn btn-secondary" data-action="delete-history" data-id="${item.id}">Hapus histori</button>
    </section>
  `).join('');

  root.querySelectorAll('button[data-action="delete-history"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (!window.confirm('Yakin ingin menghapus histori ini?')) return;
      state.history = state.history.filter(h => h.id !== id);
      await persistAndRerender();
    });
  });
}

function inputField(label, field, value, readOnly, list, day, idx) {
  return `<label>${label}<input ${list ? `list="${list}"` : ''} data-day="${day}" data-session="${idx}" data-field="${field}" value="${value ?? ''}" ${readOnly ? 'readonly' : ''}></label>`;
}

function onProgressInput(e) {
  const day = Number(e.target.dataset.day);
  const idx = Number(e.target.dataset.session);
  const card = e.target.closest('.session-card');
  const session = state.days[day].sessions[idx];

  card.querySelectorAll('input[data-field]').forEach(inp => {
    if (!inp.readOnly) session[inp.dataset.field] = inp.value.trim();
  });

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(session.actualStart)) {
    session.actualEnd = '';
  } else {
    const plannedDuration = Math.max(0, timeToMin(session.plannedEnd) - timeToMin(session.plannedStart));
    session.durationMin = plannedDuration;
    session.actualEnd = minToTime(timeToMin(session.actualStart) + plannedDuration);
  }

  validateAndComputeJuz(session);
  renderHomeSummary();
}

async function onSaveTrack(e) {
  const day = Number(e.target.dataset.day);
  const idx = Number(e.target.dataset.session);
  const session = state.days[day].sessions[idx];
  const valid = validateAndComputeJuz(session);
  if (!valid) {
    alert('Isi Surah & Ayat mulai-akhir dengan valid dulu ya.');
    return;
  }

  const trackedAtISO = new Date().toISOString();
  session.trackedAt = new Date(trackedAtISO).toLocaleString('id-ID');

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(session.actualStart)) {
    alert('Jam mulai pelaksanaan harus format HH:MM, contoh 09:00.');
    return;
  }

  const historyItem = {
    id: `${day}-${idx}`,
    day,
    sessionIndex: idx,
    trackDateISO: session.trackDateISO,
    actualStart: session.actualStart,
    actualEnd: session.actualEnd,
    durationMin: session.durationMin,
    surahStart: session.surahStart,
    ayatStart: session.ayatStart,
    surahEnd: session.surahEnd,
    ayatEnd: session.ayatEnd,
    juzStart: session.juzStart,
    juzEnd: session.juzEnd,
    uniqueJuz: session.uniqueJuz,
    trackedAtISO
  };

  const existingIndex = state.history.findIndex(h => h.id === historyItem.id);
  if (existingIndex >= 0) state.history[existingIndex] = historyItem;
  else state.history.push(historyItem);

  await persistAndRerender();
}

function validateAndComputeJuz(session) {
  const sStart = findSurah(session.surahStart);
  const sEnd = findSurah(session.surahEnd);
  const aStart = Number(session.ayatStart);
  const aEnd = Number(session.ayatEnd);
  if (!sStart || !sEnd) return false;
  if (aStart < 1 || aStart > sStart.ayahCount) return false;
  if (aEnd < 1 || aEnd > sEnd.ayahCount) return false;

  const posStart = globalPos(sStart.number, aStart);
  const posEnd = globalPos(sEnd.number, aEnd);
  const startPos = Math.min(posStart, posEnd);
  const endPos = Math.max(posStart, posEnd);
  session.juzStart = getJuzForPos(startPos);
  session.juzEnd = getJuzForPos(endPos);
  session.uniqueJuz = [];
  for (let j = session.juzStart; j <= session.juzEnd; j++) session.uniqueJuz.push(j);
  return true;
}

function renderHomeSummary() {
  const dayNum = clampDay(getRamadanDayNumber(new Date()));
  $('#ramadanDay').textContent = `Day ${dayNum}`;

  const ordered = [...state.history].sort((a, b) => new Date(a.trackedAtISO) - new Date(b.trackedAtISO));
  const last = ordered[ordered.length - 1];
  $('#lastProgress').textContent = last ? `Juz ${last.juzEnd} • ${last.surahEnd}:${last.ayatEnd}` : 'Belum ada progress';

  const allJuz = new Set(state.history.flatMap(h => h.uniqueJuz || []));
  $('#uniqueJuzSummary').textContent = `${allJuz.size}/30`;
  $('#juzProgressBar').style.width = `${(allJuz.size / 30) * 100}%`;
  saveStatusEl.textContent = state.savedAt ? `Saved ✓ ${state.savedAt}` : 'Belum tersimpan';
}

function renderStats() {
  const completed = state.history;
  const totalDur = completed.reduce((n, h) => n + (Number(h.durationMin) || 0), 0);
  const uniqueJuz = new Set(completed.flatMap(h => h.uniqueJuz || []));
  const lastJuz = [...completed].sort((a, b) => new Date(a.trackedAtISO) - new Date(b.trackedAtISO)).at(-1)?.juzEnd || '-';

  const cards = [
    ['Total sesi selesai', completed.length],
    ['Total durasi', `${totalDur} menit`],
    ['Unique juz tersentuh', `${uniqueJuz.size}/30`],
    ['Terakhir sampai juz', lastJuz],
    ['Streak hari ngaji', `${calcStreak()} hari`]
  ];
  $('#statsCards').innerHTML = cards.map(([k, v]) => `<article class="stat"><p>${k}</p><h3>${v}</h3></article>`).join('');
  drawChart();
}

function calcStreak() {
  const uniqueDays = new Set(state.history.map(h => h.day));
  let streak = 0;
  for (let d = clampDay(getRamadanDayNumber(new Date())); d >= 1; d--) {
    if (uniqueDays.has(d)) streak++;
    else if (streak > 0) break;
  }
  return streak;
}

function drawChart() {
  const canvas = $('#statsChart');
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth || 900;
  const height = 180;
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const max = 3;
  scheduleDays.forEach((d, i) => {
    const x = i * (width / RAMADAN_DAYS);
    const barW = Math.max(4, (width / RAMADAN_DAYS) - 2);
    const actual = state.history.filter(h => h.day === d.day).length;
    const targetH = (d.sessions.length / max) * (height - 30);
    const actualH = (actual / max) * (height - 30);
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, height - targetH, barW, targetH);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(x, height - actualH, barW, actualH);
  });
}

function bindGlobalButtons() {
  $('#printScheduleBtn').addEventListener('click', () => { activateTab('jadwal'); window.print(); });
  $('#printStatsBtn').addEventListener('click', () => { activateTab('stats'); window.print(); });
  $('#downloadPngBtn').addEventListener('click', downloadTodayPNG);

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
    state = { ...buildInitialState(scheduleDays), ...data };
    await persistAndRerender();
  });
}

async function downloadTodayPNG() {
  const day = clampDay(getRamadanDayNumber(new Date()));
  const sessions = state.days[day].sessions;
  const lines = sessions.map((s, i) => `Sesi ${i + 1} | ${s.actualStart}-${s.actualEnd} | ${s.surahStart || '-'}:${s.ayatStart || '-'} → ${s.surahEnd || '-'}:${s.ayatEnd || '-'} | Juz ${s.juzStart || '-'}-${s.juzEnd || '-'}`);

  const card = document.createElement('div');
  card.className = 'share-card';
  card.innerHTML = `<h1>Ramadan Day ${day}</h1><p>${formatDate(scheduleDays[day - 1].dateISO)} • Via + Fendi</p><hr>${lines.map(l => `<p>${l}</p>`).join('')}`;
  document.body.appendChild(card);
  const canvas = await html2canvas(card, { backgroundColor: '#0f172a', scale: 2 });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `ramadan-day-${day}.png`;
  a.click();
  card.remove();
}

function activateTab(tab) { document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click(); }
function findSurah(name) { return surahData.find(s => s.name.toLowerCase() === String(name).toLowerCase()); }
function globalPos(surahNum, ayah) { let t = 0; for (let i = 0; i < surahNum - 1; i++) t += surahData[i].ayahCount; return t + ayah; }
function getJuzForPos(pos) { let juz = 1; juzBoundaries.forEach((j, i) => { if (pos >= globalPos(j.surah, j.ayah)) juz = i + 1; }); return juz; }
function getRamadanDayNumber(date) { return Math.floor((new Date(date.toDateString()) - START_DATE) / 86400000) + 1; }
function clampDay(d) { return Math.min(RAMADAN_DAYS, Math.max(1, d)); }
function timeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minToTime(n) { return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
function formatDate(iso) { return new Date(iso).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); }

async function persistAndRerender() {
  state.savedAt = new Date().toLocaleTimeString('id-ID');
  await saveState(state);
  renderSchedule();
  renderTrackerToday();
  renderHistory();
  renderStats();
  renderHomeSummary();
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
