// 執行：node tests/core.test.js
const assert = require('assert');
const G = require('../core.js');

const T = (y, m, d, hh, mm = 0) => G.toMinutes(y, m, d, hh, mm);
let n = 0;
const M = (duty) => G.dutyIntervals(G.monthRange(2026, 10), 2026, 10, duty);
function test(name, fn) { fn(); n++; console.log('ok -', name); }

test('解析民國年起訖，忽略其他文字', () => {
  const text = '執勤日期時間\t勤務項目\n115/10/24 08:00 ~ 115/10/24 10:00\t巡邏_一線巡邏\t林某\n115/10/24 18:00 ~ 115/10/24 20:00\t巡邏_交通稽查';
  const { records } = G.parseRecords(text);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].start, T(2026, 10, 24, 8));
  assert.strictEqual(records[1].end, T(2026, 10, 24, 20));
});

test('跨日紀錄與省略訖日', () => {
  const { records } = G.parseRecords('115/10/24 22:00~115/10/25 00:00\n115/10/25 23:00 ~ 01:00');
  assert.strictEqual(records[0].end, T(2026, 10, 25, 0));
  assert.strictEqual(records[1].end, T(2026, 10, 26, 1));
});

test('班型轉格子', () => {
  assert.deepStrictEqual(G.shiftHours(8, 20), [0,1,2,3,4,5,6,7,8,9,10,11]);
  assert.deepStrictEqual(G.shiftHours(20, 8), [12,13,14,15,16,17,18,19,20,21,22,23]);
  assert.strictEqual(G.shiftHours(8, 8).length, 24);
});

test('截圖情境：排日班＋晚班，只打到 20:00 → 20:00–08:00 漏打，歸 10/24 勤務日', () => {
  const duty = { '2026-10-24': G.shiftHours(8, 8) };
  const text = ['08:00 ~ 115/10/24 10:00', '10:00 ~ 115/10/24 12:00', '12:00 ~ 115/10/24 14:00',
    '14:00 ~ 115/10/24 16:00', '16:00 ~ 115/10/24 18:00', '18:00 ~ 115/10/24 20:00']
    .map(s => '115/10/24 ' + s).join('\n') + '\n115/10/25 08:00 ~ 115/10/25 10:00';
  const { records } = G.parseRecords(text);
  const r = G.analyze(2026, 10, M(duty), records);
  assert.strictEqual(r.gaps.length, 1);
  assert.strictEqual(r.gaps[0].day, 24);
  assert.strictEqual(r.gaps[0].start, T(2026, 10, 24, 20));
  assert.strictEqual(r.gaps[0].end, T(2026, 10, 25, 8));
  assert.strictEqual(r.gapMinutes, 12 * 60);
  // 10/25 08–10 沒排勤 → 排勤外紀錄
  assert.strictEqual(r.extras.length, 1);
  assert.strictEqual(r.extras[0].day, 25);
  assert.strictEqual(r.cells['2026-10-24'][11], 'duty');
  assert.strictEqual(r.cells['2026-10-24'][12], 'gap');
  assert.strictEqual(r.cells['2026-10-25'][0], 'extra');
});

test('部分漏打按分鐘', () => {
  const duty = { '2026-10-03': [2, 3] }; // 10:00–12:00
  const { records } = G.parseRecords('115/10/03 10:00 ~ 115/10/03 11:30');
  const r = G.analyze(2026, 10, M(duty), records);
  assert.strictEqual(r.gapMinutes, 30);
  assert.strictEqual(r.cells['2026-10-03'][2], 'duty');
  assert.strictEqual(r.cells['2026-10-03'][3], 'partial');
});

test('月份依勤務日：11/1 07:00 屬 10/31；10/1 07:00 不在 10 月', () => {
  const duty = { '2026-10-31': [23] }; // 11/1 07:00–08:00
  const { records } = G.parseRecords('115/11/01 07:00 ~ 115/11/01 08:00\n115/10/01 06:00 ~ 115/10/01 07:00');
  const r = G.analyze(2026, 10, M(duty), records);
  assert.strictEqual(r.gaps.length, 0);
  assert.strictEqual(r.recordCount, 1);
  assert.strictEqual(r.ignored, 1);
});

test('尚未貼紀錄時不算漏打', () => {
  const r = G.analyze(2026, 10, M({ '2026-10-05': [0] }), null);
  assert.strictEqual(r.gaps.length, 0);
  assert.strictEqual(r.cells['2026-10-05'][0], 'pending');
});

test('出勤紀錄（新到舊）→ 區段，項目取出勤列', () => {
  const text = [
    '115/10/02 08:00\t出勤\t值班_值班',
    '115/10/01 20:00\t退勤\t值班_值班',
    '115/10/01 18:00\t出勤\t備勤_備勤',
    '115/10/01 18:00\t退勤\t備勤_備勤',
    '115/10/01 16:00\t出勤\t其他_連假交管',
    '115/10/01 16:00\t退勤\t其他_連假交管',
    '115/10/01 10:00\t出勤\t值班_值班',
    '115/10/01 10:00\t退勤\t值班_值班',
    '115/10/01 08:00\t出勤\t備勤_備勤',
  ].join('\n');
  const ev = G.parseAttendance(text);
  assert.strictEqual(ev.length, 9);
  const { segments, open } = G.attendanceSegments(ev);
  assert.strictEqual(open, 1); // 10/02 08:00 還沒有下一筆
  assert.deepStrictEqual(segments.map(s => s.item), ['備勤_備勤', '值班_值班', '其他_連假交管', '備勤_備勤']);
  assert.strictEqual(segments[0].end, T(2026, 10, 1, 10));
  assert.strictEqual(segments[1].end, T(2026, 10, 1, 16));
  assert.strictEqual(segments[3].end, T(2026, 10, 1, 20));
});

test('依出勤區段找漏打並帶出勤務項目', () => {
  const { segments } = G.attendanceSegments(G.parseAttendance(
    '115/10/01 08:00 出勤 備勤_備勤\n115/10/01 10:00 出勤 值班_值班\n115/10/01 12:00 退勤 值班_值班'));
  const { records } = G.parseRecords('115/10/01 08:00 ~ 115/10/01 10:00\n115/10/01 10:00 ~ 115/10/01 11:00');
  const r = G.analyze(2026, 10, segments, records);
  assert.strictEqual(r.gaps.length, 1);
  assert.strictEqual(r.gaps[0].item, '值班_值班');
  assert.strictEqual(r.gaps[0].start, T(2026, 10, 1, 11));
  assert.strictEqual(r.gaps[0].end, T(2026, 10, 1, 12));
  assert.strictEqual(r.cells['2026-10-01'][2], 'duty');
  assert.strictEqual(r.cells['2026-10-01'][3], 'gap');
});

console.log(n + ' tests passed');
