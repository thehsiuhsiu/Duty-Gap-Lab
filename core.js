// 純邏輯：解析工作紀錄、計算漏打時段。不碰 DOM，可在 Node 測試。
// 時間一律用「分鐘數」（以 UTC 計算當地時間，避免時區干擾；臺灣沒有日光節約）。
(function (root) {
  'use strict';

  const DAY_START_HOUR = 8; // 勤務日從 08:00 開始
  const MIN = 60 * 1000;

  function toMinutes(y, m, d, hh, mm) {
    return Date.UTC(y, m - 1, d, hh, mm) / MIN;
  }

  function fromMinutes(t) {
    const dt = new Date(t * MIN);
    return {
      y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
      hh: dt.getUTCHours(), mm: dt.getUTCMinutes(), wd: dt.getUTCDay(),
    };
  }

  function rocToYear(y) {
    y = Number(y);
    return y < 1000 ? y + 1911 : y;
  }

  // 抓出文字中所有「起 ~ 訖」執勤日期時間。訖的日期可省略（沿用起日，若訖時間較早視為隔天）。
  const RECORD_RE = /(\d{2,4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})\s*[~～〜\-－—至到]+\s*(?:(\d{2,4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s+)?(\d{1,2})\s*[:：]\s*(\d{2})/g;

  function parseRecords(text) {
    const records = [];
    let bad = 0;
    let m;
    RECORD_RE.lastIndex = 0;
    while ((m = RECORD_RE.exec(text)) !== null) {
      const sy = rocToYear(m[1]);
      const start = toMinutes(sy, +m[2], +m[3], +m[4], +m[5]);
      let end;
      if (m[6]) {
        end = toMinutes(rocToYear(m[6]), +m[7], +m[8], +m[9], +m[10]);
      } else {
        end = toMinutes(sy, +m[2], +m[3], +m[9], +m[10]);
        if (end <= start) end += 24 * 60;
      }
      if (!(end > start) || isNaN(start) || isNaN(end)) { bad++; continue; }
      records.push({ start, end });
    }
    return { records, bad };
  }

  // 合併重疊或相接的區間
  function mergeIntervals(list) {
    const s = list.slice().sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of s) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else out.push({ start: r.start, end: r.end });
    }
    return out;
  }

  // 某月份（依勤務日）的範圍：當月 1 日 08:00 到次月 1 日 08:00
  function monthRange(year, month) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const start = toMinutes(year, month, 1, DAY_START_HOUR, 0);
    return { start, end: start + days * 24 * 60, days };
  }

  // 第 day 個勤務日（1 起算）第 h 格（0＝08 點，23＝隔天 07 點）的開始分鐘
  function slotStart(range, day, h) {
    return range.start + ((day - 1) * 24 + h) * 60;
  }

  // 勤務日 key，例如 "2026-10-24"
  function dayKey(year, month, day) {
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  // 區間清單與 [a,b) 重疊的分鐘數
  function coveredMinutes(merged, a, b) {
    let sum = 0;
    for (const r of merged) {
      if (r.end <= a) continue;
      if (r.start >= b) break;
      sum += Math.min(b, r.end) - Math.max(a, r.start);
    }
    return sum;
  }

  // 從 [a,b) 中扣掉 merged，回傳剩下的區間
  function subtract(a, b, merged) {
    const out = [];
    let cur = a;
    for (const r of merged) {
      if (r.end <= cur) continue;
      if (r.start >= b) break;
      if (r.start > cur) out.push({ start: cur, end: r.start });
      cur = Math.max(cur, r.end);
      if (cur >= b) break;
    }
    if (cur < b) out.push({ start: cur, end: b });
    return out;
  }

  // 把勾選的格子轉成排勤區段（相鄰格合併，沒有勤務項目）
  function dutyIntervals(range, year, month, duty) {
    const list = [];
    for (let d = 1; d <= range.days; d++) {
      const hours = duty[dayKey(year, month, d)];
      if (!hours) continue;
      for (const h of hours) {
        const s = slotStart(range, d, h);
        list.push({ start: s, end: s + 60 });
      }
    }
    return mergeIntervals(list).map(r => ({ start: r.start, end: r.end, item: '' }));
  }

  // 解析出勤紀錄：每列「日期 時間｜出勤或退勤｜勤務項目」，順序不拘（新到舊也可以）
  const ATT_RE = /(\d{2,4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s+(\d{1,2})\s*[:：]\s*(\d{2})[ \t]*(出勤|退勤)[ \t]*([^\t\r\n]*)/g;
  function parseAttendance(text) {
    const events = [];
    let m;
    ATT_RE.lastIndex = 0;
    while ((m = ATT_RE.exec(text)) !== null) {
      events.push({
        t: toMinutes(rocToYear(m[1]), +m[2], +m[3], +m[4], +m[5]),
        type: m[6] === '出勤' ? 'in' : 'out',
        item: m[7].trim(),
      });
    }
    return events;
  }

  // 出勤紀錄 → 排勤區段。每筆「出勤」開始一段，到下一個較晚的出勤或退勤為止；
  // 勤務項目一律取「出勤」那一列（退勤列的項目在系統匯出時會錯開，不採用）。
  function attendanceSegments(events) {
    const times = [...new Set(events.map(e => e.t))].sort((a, b) => a - b);
    const segs = [];
    let open = 0;
    const seen = new Set();
    for (const e of events.filter(e => e.type === 'in').sort((a, b) => a.t - b.t)) {
      if (seen.has(e.t)) continue; // 同一時間重複出勤只算一次
      seen.add(e.t);
      const next = times.find(t => t > e.t);
      if (next === undefined) { open++; continue; }
      segs.push({ start: e.t, end: next, item: e.item });
    }
    return { segments: segs, open };
  }

  // 主計算。dutySegs: [{start,end,item}]；records: [{start,end}] 或 null（尚未貼）
  function analyze(year, month, dutySegs, records) {
    const range = monthRange(year, month);
    const hasRecords = Array.isArray(records);
    const inMonth = hasRecords
      ? records.filter(r => r.end > range.start && r.start < range.end)
      : [];
    const merged = mergeIntervals(inMonth.map(r => ({
      start: Math.max(r.start, range.start), end: Math.min(r.end, range.end),
    })));
    const segs = dutySegs
      .filter(r => r.end > range.start && r.start < range.end)
      .map(r => ({ start: Math.max(r.start, range.start), end: Math.min(r.end, range.end), item: r.item || '' }))
      .sort((a, b) => a.start - b.start);
    const dutyMerged = mergeIntervals(segs);

    // 漏打時段：每段排勤扣掉紀錄，保留勤務項目；同項目又相接的合併
    const rawGaps = [];
    if (hasRecords) {
      for (const sg of segs) {
        for (const g of subtract(sg.start, sg.end, merged)) rawGaps.push({ start: g.start, end: g.end, item: sg.item });
      }
    }
    const gaps = [];
    for (const g of rawGaps.sort((a, b) => a.start - b.start)) {
      const last = gaps[gaps.length - 1];
      if (last && last.item === g.item && g.start <= last.end) last.end = Math.max(last.end, g.end);
      else gaps.push({ ...g });
    }
    // 排勤外紀錄：紀錄扣掉排勤區間
    const extras = [];
    for (const r of merged) extras.push(...subtract(r.start, r.end, dutyMerged));

    // 每格狀態
    const cells = {};
    for (let d = 1; d <= range.days; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        const s = slotStart(range, d, h), e = s + 60;
        const dutyMin = coveredMinutes(dutyMerged, s, e);
        const gapMin = coveredMinutes(mergeIntervals(gaps), s, e);
        let st = '';
        if (dutyMin > 0) {
          if (!hasRecords) st = 'pending';
          else if (gapMin === 0) st = 'duty';
          else if (gapMin >= dutyMin) st = 'gap';
          else st = 'partial';
        } else if (hasRecords && coveredMinutes(merged, s, e) > 0) st = 'extra';
        row.push(st);
      }
      cells[dayKey(year, month, d)] = row;
    }

    const splitByDay = (list) => {
      const out = [];
      for (const g of list) {
        let s = g.start;
        while (s < g.end) {
          const dayIdx = Math.floor((s - range.start) / 1440);
          const dayEnd = range.start + (dayIdx + 1) * 1440;
          const e = Math.min(g.end, dayEnd);
          out.push({ day: dayIdx + 1, start: s, end: e, item: g.item || '' });
          s = e;
        }
      }
      return out;
    };

    let first = null, last = null;
    for (const r of inMonth) {
      if (first === null || r.start < first) first = r.start;
      if (last === null || r.end > last) last = r.end;
    }

    return {
      range, cells,
      gaps: splitByDay(gaps),
      extras: splitByDay(extras),
      gapMinutes: gaps.reduce((a, g) => a + g.end - g.start, 0),
      recordCount: inMonth.length,
      ignored: hasRecords ? records.length - inMonth.length : 0,
      first, last,
      dutySegCount: segs.length,
    };
  }

  // 班型 → 格子索引。start/end 為整點（0–23），end 等於 start 視為整天
  function shiftHours(start, end) {
    const a = (start - DAY_START_HOUR + 24) % 24;
    let b = (end - DAY_START_HOUR + 24) % 24;
    if (b <= a) b += 24;
    const out = [];
    for (let i = a; i < b; i++) out.push(i % 24);
    return out;
  }

  const api = {
    DAY_START_HOUR, toMinutes, fromMinutes, parseRecords, mergeIntervals,
    monthRange, slotStart, dayKey, analyze, shiftHours, subtract,
    dutyIntervals, parseAttendance, attendanceSegments,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DutyGap = api;
})(this);
