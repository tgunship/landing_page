// 実行: TZ=Asia/Tokyo node --test kokage/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Logic.gs を Node で読み込む（GAS と同じくグローバルに定義される）
const ctx = { module: { exports: {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Logic.gs'), 'utf8'), ctx);
const L = ctx.module.exports;

const cfg = {
  MIN_TOTAL_PARTICIPANTS: 4, MIN_GUEST_PARTICIPANTS: 2, GO_NOGO_DAYS_BEFORE: 3, GO_NOGO_HOUR: 12,
  VENUE_FEE: 500, GUEST_FIRST_FEE: 1000, GUEST_REGULAR_FEE: 6000, ACTION_DISCOUNT_AMOUNT: 1000,
  INSTAGRAM_URL: 'https://www.instagram.com/kokochi1205/', INSTAGRAM_HANDLE: '@kokochi1205'
};

test('料金：LQメンバー・IQ受講生は場所代のみ500円', () => {
  assert.equal(L.calcFee({ role: 'member' }, cfg).total, 500);
  assert.equal(L.calcFee({ role: 'iq', shareDeclared: true }, cfg).total, 500);
});

test('料金：一般', () => {
  assert.equal(L.calcFee({ role: 'guest', isFirstTime: true }, cfg).total, 1500);
  assert.equal(L.calcFee({ role: 'guest', isFirstTime: true, shareDeclared: true }, cfg).total, 500);
  assert.equal(L.calcFee({ role: 'guest', isFirstTime: false }, cfg).total, 6500);
  assert.equal(L.calcFee({ role: 'guest', isFirstTime: false, shareDeclared: true }, cfg).total, 5500);
});

test('区分の表記ゆれ', () => {
  assert.equal(L.normalizeRole('LQメンバー'), 'member');
  assert.equal(L.normalizeRole('member'), 'member');
  assert.equal(L.normalizeRole('IQ受講生'), 'iq');
  assert.equal(L.normalizeRole('iq_student'), 'iq');
  assert.equal(L.normalizeRole('一般'), 'guest');
  assert.equal(L.normalizeRole(''), 'guest');
});

test('初回判定：中止になった回は数えない／キャンセルは数えない', () => {
  const events = { A: { status: '中止' }, B: { status: '終了' }, C: { status: '募集中' } };
  const reg = (event_id, status = '申込', type = '一般') => ({ line_user_id: 'U1', event_id, status, type });
  assert.equal(L.isFirstTimeGuest('U1', [], events, 'C'), true);
  assert.equal(L.isFirstTimeGuest('U1', [reg('A')], events, 'C'), true);
  assert.equal(L.isFirstTimeGuest('U1', [reg('B', 'キャンセル')], events, 'C'), true);
  assert.equal(L.isFirstTimeGuest('U1', [reg('B')], events, 'C'), false);
  assert.equal(L.isFirstTimeGuest('U1', [reg('C')], events, 'C'), true); // 自分自身の回は除外
  assert.equal(L.isFirstTimeGuest('U1', [reg('B', '申込', 'LQメンバー')], events, 'C'), true);
});

test('開催判定：合計4名以上かつ一般2名以上', () => {
  const regs = (types) => types.map((type, i) => ({ event_id: 'E', status: '申込', type, line_user_id: 'U' + i }));
  const c1 = L.countParticipants('E', regs(['ホスト', 'LQメンバー', '一般', '一般']));
  assert.deepEqual({ ...c1 }, { total: 4, guests: 2, members: 2 });
  assert.equal(L.isGo(c1, cfg), true);
  assert.equal(L.isGo(L.countParticipants('E', regs(['ホスト', 'LQメンバー', 'IQ受講生', '一般'])), cfg), false);
  assert.equal(L.isGo(L.countParticipants('E', regs(['ホスト', '一般', '一般'])), cfg), false);
  const withCancel = regs(['ホスト', '一般', '一般', '一般']);
  withCancel[3].status = 'キャンセル';
  assert.equal(L.isGo(L.countParticipants('E', withCancel), cfg), false);
});

test('判定タイミング：開催3日前の12時から', () => {
  const ev = { status: '募集中', date: '2026-12-08', start_time: '13:00', end_time: '16:00' };
  assert.equal(L.shouldDecideNow(ev, new Date(2026, 11, 5, 11, 59), cfg), false);
  assert.equal(L.shouldDecideNow(ev, new Date(2026, 11, 5, 12, 0), cfg), true);
  assert.equal(L.shouldDecideNow({ ...ev, status: '開催決定' }, new Date(2026, 11, 5, 12, 0), cfg), false);
});

test('終了処理・受付可否', () => {
  const ev = { status: '開催決定', date: '2026-12-08', start_time: '13:00', end_time: '16:00' };
  assert.equal(L.shouldFinishNow(ev, new Date(2026, 11, 8, 15, 59)), false);
  assert.equal(L.shouldFinishNow(ev, new Date(2026, 11, 8, 16, 0)), true);
  // キャンセルは開催決定後も開始時刻まで
  assert.equal(L.isOpenForCancel(ev, new Date(2026, 11, 8, 12, 59)), true);
  assert.equal(L.isOpenForCancel(ev, new Date(2026, 11, 8, 13, 0)), false);
  assert.equal(L.isOpenForCancel({ ...ev, status: '中止' }, new Date(2026, 11, 1)), false);
});

test('申込は開始時刻まで（開催決定後も可・中止は不可）', () => {
  const ev = { status: '募集中', date: '2026-12-08', start_time: '13:00', end_time: '16:00' };
  assert.equal(L.isOpenForApply(ev, new Date(2026, 11, 5, 11, 59)), true);
  assert.equal(L.isOpenForApply({ ...ev, status: '開催決定' }, new Date(2026, 11, 8, 12, 59)), true);
  assert.equal(L.isOpenForApply({ ...ev, status: '開催決定' }, new Date(2026, 11, 8, 13, 0)), false);
  assert.equal(L.isOpenForApply({ ...ev, status: '中止' }, new Date(2026, 11, 1)), false);
});

test('開催決定後の追加申込：運営向けとホスト向けで文面が変わる', () => {
  const ev = { title: 't', date: '2026-12-08', start_time: '13:00' };
  const counts = { total: 5, guests: 3, members: 2 };
  assert.match(L.buildAdminChangeMessage('apply', ev, 'はなこ', counts, false), /管理者通知.*追加申込[\s\S]*会場予約/);
  assert.match(L.buildAdminChangeMessage('apply', ev, 'はなこ', counts, true), /ホストのあなたへ[\s\S]*申込状況/);
});

test('初回料金の割り当て：初回の回が中止・キャンセルになると次の申込が初回に戻る', () => {
  const reg = (reg_id, event_id, created_at, status = '申込') => ({ reg_id, event_id, created_at, status, type: '一般', line_user_id: 'U1' });
  const regs = [reg('R1', 'A', '2026-11-01 10:00:00'), reg('R2', 'B', '2026-11-02 10:00:00'), reg('R3', 'C', '2026-11-03 10:00:00')];
  const ev = (status) => ({ status });
  let plan = L.firstTimeAssignments('U1', regs, { A: ev('募集中'), B: ev('募集中'), C: ev('募集中') });
  assert.deepEqual({ ...plan }, { R1: true, R2: false, R3: false });
  plan = L.firstTimeAssignments('U1', regs, { A: ev('中止'), B: ev('募集中'), C: ev('募集中') });
  assert.deepEqual({ ...plan }, { R2: true, R3: false });
  const cancelled = [reg('R1', 'A', '2026-11-01 10:00:00', 'キャンセル'), regs[1], regs[2]];
  plan = L.firstTimeAssignments('U1', cancelled, { A: ev('募集中'), B: ev('募集中'), C: ev('募集中') });
  assert.equal(plan.R2, true);
  // すでに参加した回（終了）があれば、以降はすべて2回目以降
  plan = L.firstTimeAssignments('U1', regs, { A: ev('終了'), B: ev('募集中'), C: ev('募集中') });
  assert.deepEqual({ ...plan }, { R1: true, R2: false, R3: false });
});

test('お礼メッセージ：一般全員へ、割引申告の有無で文面が変わる', () => {
  const ev = { title: 't', date: '2026-12-08' };
  assert.match(L.buildThanksMessage('a', ev, cfg, true), /ぜひInstagram/);
  assert.match(L.buildThanksMessage('a', ev, cfg, false), /もしよければ/);
});

test('日付・時刻の整形', () => {
  assert.equal(L.addHoursToTime('13:00', 3), '16:00');
  assert.equal(L.normalizeDate('2026/12/8'), '2026-12-08');
  assert.equal(L.normalizeTime('9:30'), '09:30');
  assert.equal(L.formatJpDate('2026-12-08'), '12月8日（火）');
  assert.equal(L.formatYen(6500), '6,500円');
});

test('トリガーメッセージ：受信箱で読める内容＋往復', () => {
  const ev = { title: 'キャンセルしたくなる私の木陰', date: '2026-12-08', start_time: '13:00', status: '開催決定' };
  const full = L.buildTriggerText('apply', 'E-AB12CD34', ev);
  assert.match(full, /12月8日（火） 13:00〜『キャンセルしたくなる私の木陰』（開催決定済み）/);
  assert.doesNotMatch(full, /名/); // 参加者本人のトークにも残るので人数は載せない
  // タイトルに「キャンセル」が入っていても申込として読む
  assert.deepEqual({ ...L.parseTriggerMessage(full) }, { kind: 'apply', eventId: 'E-AB12CD34' });
  const t = L.buildTriggerText('apply', 'E-AB12CD34');
  assert.deepEqual({ ...L.parseTriggerMessage(t) }, { kind: 'apply', eventId: 'E-AB12CD34' });
  const c = L.buildTriggerText('cancel', 'E-AB12CD34');
  assert.deepEqual({ ...L.parseTriggerMessage(c) }, { kind: 'cancel', eventId: 'E-AB12CD34' });
  assert.equal(L.parseTriggerMessage('こんにちは'), null);
});

test('申込返信メッセージに料金内訳が入る', () => {
  const ev = { title: 'ほっと一息', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'イバフォルニア・ベース', status: '募集中' };
  const reg = { type: '一般', first_time: 'はい', share_declared: 'はい', fee: '500' };
  const text = L.buildApplyReply('はなこ', ev, reg, cfg);
  assert.match(text, /500円/);
  assert.match(text, /初回/);
  assert.match(text, /発信・口コミ割引1,000円/);
  assert.match(text, /3日前の12時/);
});

test('型：表記から探せる・作品名の案内', () => {
  assert.equal(L.findFormat('共感セッション').key, 'empathy');
  assert.equal(L.findFormat('movie').label, '映画シェア会');
  assert.equal(L.findFormat('なにか'), null);
  assert.match(L.workLine({ format: '映画シェア会', work_title: 'ちひろさん' }), /映画『ちひろさん』を事前に観て/);
  assert.match(L.workLine({ format: '読書会', work_title: '本' }), /持っていなくて大丈夫/);
  assert.equal(L.workLine({ format: '共感セッション', work_title: 'x' }), '');
  const lines = L.eventLines({ format: '読書会', work_title: '本', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'v' });
  assert.match(lines, /^🌿 読書会/);
});
