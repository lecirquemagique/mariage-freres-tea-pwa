'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sales = require('../sales-state');
const root = path.join(__dirname, '..');
const oldTea = { VersionKey: 'T8307-B01', 'Primary Reference': 'T8307',
  '銘柄名（黒い本）': 'JASMIN GUANG XI', '茶種タグ': '緑茶', '産地・国': '中国',
  '産地・地域／茶園': '広西', '香味大分類': '花', '香味詳細タグ': 'ジャスミン',
  '公式掲載状態': '未掲載', '現行ステータス': '終売未確定' };
const newTea = { ...oldTea, VersionKey: 'T8307-C01', '銘柄名（黒い本）': '',
  '現在の公式名': 'BLANC JASMIN', '茶種タグ': '白茶', '産地・地域／茶園': '雲南',
  '公式掲載状態': '掲載中', '現行ステータス': '販売中' };

for (const [name, row, expected] of [
  ['販売中・掲載中', newTea, [true, true, false]],
  ['一時欠品・掲載中', { ...newTea, '現行ステータス': '一時欠品・入荷待ち' }, [true, true, false]],
  ['未掲載旧版・終売未確定', oldTea, [false, true, true]],
  ['掲載中でも終売確定', { ...newTea, '現行ステータス': '終売確定' }, [false, true, true]],
  ['新列がない旧API', { VersionKey: 'T1-B01', '現行ステータス': '現行' }, [false, true, false]],
  ['未確認', { ...newTea, '公式掲載状態': '未確認' }, [false, true, false]],
  ['旧販売終了を終売確定へ自動変換しない', { '現行ステータス': '販売終了' }, [false, true, false]]
]) test(name, () => assert.deepEqual(['shopping', 'all', 'past'].map(scope => sales.matchesScope(row, scope, true)), expected));

test('Version番号で旧版推定せずPrimaryと掲載状態でバッジ表示', () => {
  assert.deepEqual(sales.badges(oldTea, [oldTea, newTea]), ['公式未掲載', '旧版']);
  assert.deepEqual(sales.badges(newTea, [oldTea, newTea]), ['公式掲載中']);
  assert.equal(sales.isOldVersion(oldTea, [oldTea, { ...newTea, 'Primary Reference': 'TFBF8307' }]), false);
});

function pwaContext() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
  const nodes = {};
  const document = { getElementById(id) {
    return nodes[id] ||= { value: id === 'displayScope' ? 'shopping' : '', checked: false,
      addEventListener() {}, innerHTML: '', textContent: '', querySelectorAll: () => [] };
  }};
  const ctx = { document, window: { MF_APP_CONFIG: {} }, MFSalesState: sales };
  vm.createContext(ctx);
  // Exercise actual app functions; omit only network/SW bootstrap.
  vm.runInContext(source.split('\napplyBrand();')[0], ctx);
  return { ctx, nodes, html };
}

test('実PWAの検索・茶種・産地・香味と表示範囲を併用できる', () => {
  const { ctx, nodes } = pwaContext();
  ctx.fixtures = [oldTea, newTea];
  vm.runInContext('R=fixtures;', ctx);
  nodes.displayScope.value = 'all';
  const count = () => vm.runInContext('R.filter(matches).length', ctx);
  assert.equal(count(), 2);
  nodes.q.value = 'JASMIN';
  nodes.tea.value = '緑茶';
  nodes.origin.value = '中国';
  vm.runInContext("aromaSel.add('花'); detailSel.add('ジャスミン');", ctx);
  assert.equal(count(), 1);
  nodes.displayScope.value = 'shopping';
  assert.equal(count(), 0);
  nodes.tea.value = '白茶';
  assert.equal(count(), 1);
  nodes.origin.value = 'インド';
  assert.equal(count(), 0);
  nodes.origin.value = '中国';
  nodes.displayScope.value = 'past';
  assert.equal(count(), 0);
  nodes.tea.value = '緑茶';
  assert.equal(count(), 1);
});

test('実PWAカードはVersion分離後の両銘柄を表示しresetで買い物へ戻る', () => {
  const { ctx, nodes, html } = pwaContext();
  ctx.fixtures = [oldTea, newTea];
  vm.runInContext('R=fixtures;', ctx);
  nodes.displayScope.value = 'all';
  vm.runInContext('render();', ctx);
  assert.match(nodes.list.innerHTML, /JASMIN GUANG XI/);
  assert.match(nodes.list.innerHTML, /BLANC JASMIN/);
  assert.match(nodes.list.innerHTML, /旧版/);
  assert.doesNotMatch(html, /id="end"|\$\('end'\)|終売を除く/);
  // Chip render functions need browser DOM; stub only these presentation helpers.
  vm.runInContext('renderAromaChips=()=>{};renderTimeChips=()=>{};reset();', ctx);
  assert.equal(nodes.displayScope.value, 'shopping');
  assert.doesNotMatch(nodes.list.innerHTML, /JASMIN GUANG XI/);
  assert.match(nodes.list.innerHTML, /BLANC JASMIN/);
});

test('移行前は未知行を保持、移行完了後だけ厳格な買い物になる', () => {
  for (const listing of ['', '未確認', undefined]) {
    const row = { '公式掲載状態': listing, '現行ステータス': '販売中' };
    assert.equal(sales.matchesScope(row, 'shopping'), true);
    assert.equal(sales.matchesScope(row, 'shopping', true), false);
    assert.equal(sales.matchesScope(row, 'all', true), true);
    assert.equal(sales.matchesScope(row, 'past'), false);
  }
  assert.equal(sales.matchesScope(oldTea, 'shopping'), false);
  assert.equal(sales.matchesScope({ '現行ステータス': '終売確定' }, 'shopping'), false);
  assert.equal(sales.matchesScope({ '現行ステータス': '販売終了' }, 'shopping'), false);
  assert.equal(sales.matchesScope({ ...newTea, '現行ステータス': '一時欠品・入荷待ち' }, 'shopping', true), true);
});

test('760件の未初期化snapshotは移行中に旧表示件数を保持する', () => {
  const source = path.join(root, 'logs/sales-state-master-20261004.json');
  if (!fs.existsSync(source)) return;
  const { values } = JSON.parse(fs.readFileSync(source, 'utf8'));
  const rows = values.slice(1).filter(row => row[0]).map(row =>
    Object.fromEntries(values[0].map((key, i) => [key, row[i] || ''])));
  const legacyCount = rows.filter(row => !['終売', '販売終了'].includes(row['現行ステータス'])).length;
  assert.equal(legacyCount, 754);
  assert.equal(rows.filter(row => sales.matchesScope(row, 'shopping')).length, legacyCount);
  assert.equal(rows.filter(row => sales.matchesScope(row, 'shopping', true)).length, 0);
  assert.equal(rows.filter(row => sales.matchesScope(row, 'all')).length, 760);
});


test('完了フラグは明示boolean trueのみ受理、旧API・不正値はfallback', () => {
  for (const payload of [{}, { salesStateMigration: { complete: true } },
    { salesStateMigration: { version: 1, complete: 'true' } }, { salesStateMigration: { version: 2, complete: true } }]) {
    assert.equal(sales.migrationComplete(payload), false);
  }
  assert.equal(sales.migrationComplete({ salesStateMigration: { version: 1, complete: true } }), true);
});
