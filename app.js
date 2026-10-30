(function () {
  'use strict';
  const G = window.DutyGap;
  const STORE_KEY = 'dutyGap.v1';
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const DEFAULT_SHIFTS = [
    { name: '日班', start: 8, end: 20 },
    { name: '晚班', start: 20, end: 8 },
  ];

  // ---------- 狀態 ----------
  const now = new Date();
  // 凌晨 00–08 仍屬前一個勤務日
  const today = new Date(now.getTime() - G.DAY_START_HOUR * 3600 * 1000);
  const state = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    duty: {},          // { "YYYY-MM-DD": [格子索引] }
    shifts: DEFAULT_SHIFTS.slice(),
    records: null,     // 不保存
    checkedDays: new Set(),
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data.duty === 'object') state.duty = data.duty;
      if (data && Array.isArray(data.shifts)) state.shifts = data.shifts;
    } catch (e) { /* 讀不到就用預設 */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ duty: state.duty, shifts: state.shifts }));
    } catch (e) {
      showMsg('toolbarMsg', '無法存到瀏覽器，關掉網頁後排勤會消失。', true);
    }
  }

  // ---------- 小工具 ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const roc = (y) => y - 1911;
  function fmtHM(t) { const f = G.fromMinutes(t); return pad(f.hh) + ':' + pad(f.mm); }
  function fmtMD(t) { const f = G.fromMinutes(t); return f.m + '/' + f.d; }
  function fmtDur(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' 小時' : '') + (m ? (h ? ' ' : '') + m + ' 分' : '') || '0 分';
  }
  function hourLabel(h) { return pad((h + G.DAY_START_HOUR) % 24); }
  function showMsg(id, text, warn) {
    const el = $(id);
    el.textContent = text || '';
    el.classList.toggle('warn', !!warn);
  }
  function getHours(key) { return new Set(state.duty[key] || []); }
  function setHours(key, set) {
    if (set.size) state.duty[key] = [...set].sort((a, b) => a - b);
    else delete state.duty[key];
  }

  // ---------- 網格 ----------
  const grid = $('grid');
  let cellEls = {}; // key -> [td...]

  function buildGrid() {
    const range = G.monthRange(state.year, state.month);
    grid.innerHTML = '';
    cellEls = {};
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'daycol';
    corner.textContent = '勤務日';
    hr.appendChild(corner);
    for (let h = 0; h < 24; h++) {
      const th = document.createElement('th');
      th.textContent = hourLabel(h);
      if (h === 12) th.className = 'split';
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    grid.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let d = 1; d <= range.days; d++) {
      const key = G.dayKey(state.year, state.month, d);
      const wd = new Date(Date.UTC(state.year, state.month - 1, d)).getUTCDay();
      const tr = document.createElement('tr');
      if (wd === 0 || wd === 6) tr.classList.add('weekend');
      if (state.checkedDays.has(key)) tr.classList.add('checked');
      const th = document.createElement('th');
      th.className = 'daycol';
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.checkedDays.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) state.checkedDays.add(key); else state.checkedDays.delete(key);
        tr.classList.toggle('checked', cb.checked);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(state.month + '/' + d + '（' + WEEK[wd] + '）'));
      th.appendChild(label);
      tr.appendChild(th);
      const tds = [];
      for (let h = 0; h < 24; h++) {
        const td = document.createElement('td');
        td.className = 'c' + (h === 12 ? ' split' : '');
        td.dataset.day = d;
        td.dataset.h = h;
        tr.appendChild(td);
        tds.push(td);
      }
      cellEls[key] = tds;
      tbody.appendChild(tr);
    }
    grid.appendChild(tbody);
  }

  // ---------- 拖曳框選 ----------
  let drag = null; // { d0, h0, d1, h1, on }
  function cellFromEvent(e) {
    const td = e.target.closest && e.target.closest('td.c');
    return td ? { d: +td.dataset.day, h: +td.dataset.h } : null;
  }
  function eachInRect(fn) {
    const dA = Math.min(drag.d0, drag.d1), dB = Math.max(drag.d0, drag.d1);
    const hA = Math.min(drag.h0, drag.h1), hB = Math.max(drag.h0, drag.h1);
    for (let d = dA; d <= dB; d++) for (let h = hA; h <= hB; h++) fn(d, h);
  }
  function clearPreview() {
    grid.querySelectorAll('.preview-on, .preview-off').forEach(el => el.classList.remove('preview-on', 'preview-off'));
  }
  function drawPreview() {
    clearPreview();
    const cls = drag.on ? 'preview-on' : 'preview-off';
    eachInRect((d, h) => cellEls[G.dayKey(state.year, state.month, d)][h].classList.add(cls));
  }
  grid.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const c = cellFromEvent(e);
    if (!c) return;
    e.preventDefault();
    const on = !getHours(G.dayKey(state.year, state.month, c.d)).has(c.h);
    drag = { d0: c.d, h0: c.h, d1: c.d, h1: c.h, on };
    drawPreview();
  });
  grid.addEventListener('mouseover', (e) => {
    if (!drag) return;
    const c = cellFromEvent(e);
    if (!c || (c.d === drag.d1 && c.h === drag.h1)) return;
    drag.d1 = c.d; drag.h1 = c.h;
    drawPreview();
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const touched = {};
    eachInRect((d, h) => {
      const key = G.dayKey(state.year, state.month, d);
      if (!touched[key]) touched[key] = getHours(key);
      if (drag.on) touched[key].add(h); else touched[key].delete(h);
    });
    for (const key in touched) setHours(key, touched[key]);
    drag = null;
    clearPreview();
    save();
    render();
  });

  // ---------- 班型 ----------
  function renderShifts() {
    const box = $('shiftButtons');
    box.innerHTML = '';
    const list = $('shiftList');
    list.innerHTML = '';
    state.shifts.forEach((s, i) => {
      const text = s.name + ' ' + pad(s.start) + '–' + pad(s.end);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => applyShift(s));
      box.appendChild(b);

      const li = document.createElement('li');
      li.textContent = text;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost';
      del.textContent = '刪除';
      del.addEventListener('click', () => {
        state.shifts.splice(i, 1);
        save();
        renderShifts();
      });
      li.appendChild(del);
      list.appendChild(li);
    });
  }
  function applyShift(s) {
    if (!state.checkedDays.size) {
      showMsg('toolbarMsg', '請先勾選左側要套用的日期。', true);
      return;
    }
    const hours = G.shiftHours(s.start, s.end);
    for (const key of state.checkedDays) {
      const set = getHours(key);
      hours.forEach(h => set.add(h));
      setHours(key, set);
    }
    showMsg('toolbarMsg', '已將「' + s.name + '」套用到 ' + state.checkedDays.size + ' 天。');
    save();
    render();
  }
  function fillHourSelect(sel, def) {
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = h; o.textContent = pad(h) + ':00';
      if (h === def) o.selected = true;
      sel.appendChild(o);
    }
  }
  fillHourSelect($('shiftStart'), 8);
  fillHourSelect($('shiftEnd'), 20);
  $('addShift').addEventListener('click', () => {
    const name = $('shiftName').value.trim();
    if (!name) { showMsg('toolbarMsg', '請輸入班型名稱。', true); return; }
    state.shifts.push({ name, start: +$('shiftStart').value, end: +$('shiftEnd').value });
    $('shiftName').value = '';
    save();
    renderShifts();
    showMsg('toolbarMsg', '已新增班型「' + name + '」。');
  });

  $('clearDays').addEventListener('click', () => {
    if (!state.checkedDays.size) { showMsg('toolbarMsg', '請先勾選左側要清空的日期。', true); return; }
    for (const key of state.checkedDays) delete state.duty[key];
    showMsg('toolbarMsg', '已清空 ' + state.checkedDays.size + ' 天的排勤。');
    save();
    render();
  });
  $('toggleAllDays').addEventListener('click', () => {
    const range = G.monthRange(state.year, state.month);
    const keys = [];
    for (let d = 1; d <= range.days; d++) keys.push(G.dayKey(state.year, state.month, d));
    const allChecked = keys.every(k => state.checkedDays.has(k));
    state.checkedDays = allChecked ? new Set() : new Set(keys);
    buildGrid();
    render();
  });

  // ---------- 月份 ----------
  function changeMonth(delta) {
    let m = state.month + delta, y = state.year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    state.year = y; state.month = m;
    state.checkedDays = new Set();
    showMsg('toolbarMsg', '');
    buildGrid();
    render();
  }
  $('prevMonth').addEventListener('click', () => changeMonth(-1));
  $('nextMonth').addEventListener('click', () => changeMonth(1));

  // ---------- 貼上 ----------
  let parsed = null; // { records, bad }
  $('paste').addEventListener('input', () => {
    const text = $('paste').value;
    parsed = text.trim() ? G.parseRecords(text) : null;
    state.records = parsed ? parsed.records : null;
    render();
  });
  $('clearPaste').addEventListener('click', () => {
    $('paste').value = '';
    parsed = null;
    state.records = null;
    render();
  });

  // ---------- 繪製 ----------
  function render() {
    $('monthLabel').textContent = roc(state.year) + ' 年 ' + state.month + ' 月';
    const r = G.analyze(state.year, state.month, state.duty, state.records);

    for (const key in cellEls) {
      const row = r.cells[key];
      cellEls[key].forEach((td, h) => {
        td.classList.remove('pending', 'duty', 'gap', 'partial', 'extra');
        if (row[h]) td.classList.add(row[h]);
      });
    }

    // 貼上訊息
    if (!parsed) {
      showMsg('parseMsg', '');
    } else if (!parsed.records.length) {
      showMsg('parseMsg', '沒有抓到任何執勤日期時間，請確認有複製到「115/10/24 08:00 ~ 115/10/24 10:00」這種格式。', true);
    } else {
      let t = '抓到 ' + r.recordCount + ' 筆';
      if (r.recordCount) t += '，' + fmtMD(r.first) + ' ' + fmtHM(r.first) + ' 到 ' + fmtMD(r.last) + ' ' + fmtHM(r.last);
      if (r.ignored) t += '；' + r.ignored + ' 筆不在 ' + state.month + ' 月，已忽略';
      if (parsed.bad) t += '；' + parsed.bad + ' 筆時間有誤，已略過';
      showMsg('parseMsg', t + '。', r.recordCount === 0);
    }

    // 結果
    const dutyCount = Object.keys(state.duty).filter(k => k.startsWith(state.year + '-' + pad(state.month) + '-')).length;
    const summary = $('summary');
    const list = $('gapList');
    list.innerHTML = '';
    if (!dutyCount) {
      summary.textContent = '這個月還沒點選排勤時段。';
    } else if (!state.records) {
      summary.textContent = '已點選 ' + dutyCount + ' 天排勤，貼上工作紀錄後就會開始比對。';
    } else if (!r.gaps.length) {
      summary.innerHTML = '這個月的排勤時段都有工作紀錄，沒有漏打。';
    } else {
      summary.innerHTML = '共 <b>' + r.gaps.length + '</b> 段漏打，合計 <b>' + fmtDur(r.gapMinutes) + '</b>。';
      renderGroups(list, r.gaps);
    }

    const extraBox = $('extraBox');
    if (state.records && r.extras.length) {
      extraBox.hidden = false;
      const total = r.extras.reduce((a, g) => a + g.end - g.start, 0);
      $('extraSummary').textContent = '排勤外紀錄 ' + r.extras.length + ' 段（' + fmtDur(total) + '）：有打紀錄但沒點排勤，可能漏點，不算錯';
      const el = $('extraList');
      el.innerHTML = '';
      renderGroups(el, r.extras);
    } else {
      extraBox.hidden = true;
    }
  }

  function renderGroups(container, items) {
    const byDay = new Map();
    for (const g of items) {
      if (!byDay.has(g.day)) byDay.set(g.day, []);
      byDay.get(g.day).push(g);
    }
    for (const [day, arr] of byDay) {
      const wd = new Date(Date.UTC(state.year, state.month - 1, day)).getUTCDay();
      const div = document.createElement('div');
      div.className = 'day-group';
      const h3 = document.createElement('h3');
      h3.textContent = state.month + '/' + day + '（' + WEEK[wd] + '）勤務日';
      div.appendChild(h3);
      const ul = document.createElement('ul');
      for (const g of arr) {
        const li = document.createElement('li');
        li.textContent = fmtMD(g.start) + ' ' + fmtHM(g.start) + ' – ' + fmtMD(g.end) + ' ' + fmtHM(g.end);
        const span = document.createElement('span');
        span.className = 'dur';
        span.textContent = fmtDur(g.end - g.start);
        li.appendChild(span);
        ul.appendChild(li);
      }
      div.appendChild(ul);
      container.appendChild(div);
    }
  }

  // ---------- 啟動 ----------
  load();
  renderShifts();
  buildGrid();
  render();
})();
