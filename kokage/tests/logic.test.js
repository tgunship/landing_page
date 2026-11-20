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
  NOTICE_DAYS_BEFORE: 3, NOTICE_HOUR: 12, CORE_HOURS: 2,
  VENUE_FEE: 500, GUEST_FIRST_FEE: 1000, GUEST_REGULAR_FEE: 6000, ACTION_DISCOUNT_AMOUNT: 1000,
  INSTAGRAM_URL: 'https://www.instagram.com/kokochi1205/', INSTAGRAM_HANDLE: '@kokochi1205'
};

test('参加費：IQ受講生は0円、一般は初回1,000円／2回目以降6,000円、割引1,000円（ホストでも区分どおり）', () => {
  assert.equal(L.participationFee({ role: 'iq' }, cfg).fee, 0);
  assert.equal(L.participationFee({ role: 'guest', isFirstTime: true }, cfg).fee, 1000);
  assert.equal(L.participationFee({ role: 'guest', isFirstTime: true, shareDeclared: true }, cfg).fee, 0);
  assert.equal(L.participationFee({ role: 'guest', isFirstTime: false }, cfg).fee, 6000);
  assert.equal(L.participationFee({ role: 'guest', isFirstTime: false, shareDeclared: true }, cfg).fee, 5000);
});

test('場所代：イバフォルニア・ベースは1人500円、別会場は合計を人数で割り勘（10円単位で切り上げ）', () => {
  const ibf = { venue_fee_total: '' };
  assert.equal(L.isSplitVenue(ibf), false);
  assert.equal(L.venueShare(ibf, 5, cfg), 500);
  const other = { venue_fee_total: '3000' };
  assert.equal(L.isSplitVenue(other), true);
  assert.equal(L.venueShare(other, 1, cfg), 3000); // ホストだけ
  assert.equal(L.venueShare(other, 4, cfg), 750);
  assert.equal(L.venueShare(other, 7, cfg), 430); // 428.57… → 430
  assert.equal(L.venueShare({ venue_fee_total: '0' }, 3, cfg), 0);
});

test('場所代（別会場）：1人あたりの上限つき。足りない分・端数はホストが負担', () => {
  const ev = { venue_fee_total: '3000', venue_fee_cap: '1000' };
  // 1人（ホストだけ）：ホストが全額
  assert.equal(L.hostVenueFee(ev, 1, cfg), 3000);
  // 2人：割り勘なら1,500円だが上限1,000円 → 参加者1,000円、ホスト2,000円
  assert.equal(L.venueShare(ev, 2, cfg), 1000);
  assert.equal(L.hostVenueFee(ev, 2, cfg), 2000);
  // 4人：750円ずつ（上限以下）→ ホストも750円
  assert.equal(L.venueShare(ev, 4, cfg), 750);
  assert.equal(L.hostVenueFee(ev, 4, cfg), 750);
  // 7人：430円（切り上げ）×6人＝2,580円 → ホストは残り420円（端数はホストが吸収）
  assert.equal(L.venueShare(ev, 7, cfg), 430);
  assert.equal(L.hostVenueFee(ev, 7, cfg), 420);
  assert.equal(L.venueFeeFor(ev, 2, true, cfg), 2000);
  assert.equal(L.venueFeeFor(ev, 2, false, cfg), 1000);
  // イバフォルニア・ベースはホストも500円
  assert.equal(L.hostVenueFee({ venue_fee_total: '' }, 3, cfg), 500);
});

test('申込行から参加費を出す', () => {
  assert.equal(L.participationFeeOfReg({ type: 'ホスト' }, cfg), 0); // 古い行
  assert.equal(L.participationFeeOfReg({ type: 'IQ受講生' }, cfg), 0);
  assert.equal(L.participationFeeOfReg({ type: '一般', first_time: 'はい', share_declared: 'いいえ' }, cfg), 1000);
  assert.equal(L.participationFeeOfReg({ type: '一般', first_time: 'いいえ', share_declared: 'はい' }, cfg), 5000);
});

test('区分：LQメンバーの表記もIQ受講生として扱う', () => {
  assert.equal(L.normalizeRole('IQ受講生'), 'iq');
  assert.equal(L.normalizeRole('LQメンバー'), 'iq');
  assert.equal(L.normalizeRole('member'), 'iq');
  assert.equal(L.normalizeRole('一般'), 'guest');
  assert.equal(L.normalizeRole(''), 'guest');
  assert.equal(L.regTypeForRole('iq'), 'IQ受講生');
});

test('初回の割り当て：最初の申込だけ初回。キャンセルしたら次の申込が初回に戻る', () => {
  const reg = (reg_id, event_id, created_at, status = '申込') => ({ reg_id, event_id, created_at, status, type: '一般', line_user_id: 'U1' });
  const regs = [reg('R1', 'A', '2026-11-01 10:00:00'), reg('R2', 'B', '2026-11-02 10:00:00')];
  const evs = { A: { status: '募集中' }, B: { status: '募集中' } };
  assert.deepEqual({ ...L.firstTimeAssignments('U1', regs, evs) }, { R1: true, R2: false });
  const cancelled = [reg('R1', 'A', '2026-11-01 10:00:00', 'キャンセル'), regs[1]];
  assert.deepEqual({ ...L.firstTimeAssignments('U1', cancelled, evs) }, { R2: true });
  // 参加済み（終了）の回があれば、以降は2回目以降
  assert.deepEqual({ ...L.firstTimeAssignments('U1', regs, { A: { status: '終了' }, B: { status: '募集中' } }) }, { R1: true, R2: false });
  assert.equal(L.isFirstTimeGuest('U1', regs, evs, 'B'), false);
  assert.equal(L.isFirstTimeGuest('U2', regs, evs, 'B'), true);
});

test('人数：申込シートの有効な申込だけ数える（最少人数の決まりはない）', () => {
  const regs = [
    { event_id: 'E', status: '申込', type: 'ホスト' },
    { event_id: 'E', status: '申込', type: '一般' },
    { event_id: 'E', status: 'キャンセル', type: '一般' }
  ];
  assert.deepEqual({ ...L.countParticipants('E', regs) }, { total: 2, guests: 1, members: 1 });
});

test('定期処理のタイミング：3日前12時に人数のお知らせ、本編2時間後にお礼、終了時刻で終了', () => {
  const ev = { status: '募集中', date: '2026-12-08', start_time: '13:00', end_time: '16:00' };
  assert.equal(L.shouldNoticeNow(ev, new Date(2026, 11, 5, 11, 59), cfg), false);
  assert.equal(L.shouldNoticeNow(ev, new Date(2026, 11, 5, 12, 0), cfg), true);
  assert.equal(L.shouldNoticeNow({ ...ev, decided_at: 'x' }, new Date(2026, 11, 5, 12, 0), cfg), false);
  assert.equal(L.shouldThankNow(ev, new Date(2026, 11, 8, 14, 59), cfg), false);
  assert.equal(L.shouldThankNow(ev, new Date(2026, 11, 8, 15, 0), cfg), true);
  assert.equal(L.shouldThankNow({ ...ev, thanks_sent_at: 'x' }, new Date(2026, 11, 8, 15, 0), cfg), false);
  assert.equal(L.shouldFinishNow(ev, new Date(2026, 11, 8, 15, 59)), false);
  assert.equal(L.shouldFinishNow(ev, new Date(2026, 11, 8, 16, 0)), true);
});

test('申込・キャンセルは開始時刻まで（募集中のみ）', () => {
  const ev = { status: '募集中', date: '2026-12-08', start_time: '13:00', end_time: '16:00' };
  assert.equal(L.isOpenForApply(ev, new Date(2026, 11, 8, 12, 59)), true);
  assert.equal(L.isOpenForApply(ev, new Date(2026, 11, 8, 13, 0)), false);
  assert.equal(L.isOpenForApply({ ...ev, status: '終了' }, new Date(2026, 11, 1)), false);
});

test('日付・時刻の整形', () => {
  assert.equal(L.addHoursToTime('13:00', 3), '16:00');
  assert.equal(L.normalizeDate('2026/12/8'), '2026-12-08');
  assert.equal(L.normalizeTime('9:30'), '09:30');
  assert.equal(L.formatJpDate('2026-12-08'), '12月8日（火）');
  assert.equal(L.formatYen(6500), '6,500円');
});

test('トリガーメッセージ：人数は載せない・タイトルに左右されない', () => {
  const ev = { title: 'キャンセルしたくなる私の木陰', date: '2026-12-08', start_time: '13:00', decided_at: '2026-12-05 12:00:00' };
  const full = L.buildTriggerText('apply', 'E-AB12CD34', ev);
  assert.match(full, /12月8日（火） 13:00〜『キャンセルしたくなる私の木陰』（人数お知らせ後）/);
  assert.doesNotMatch(full, /名/);
  assert.deepEqual({ ...L.parseTriggerMessage(full) }, { kind: 'apply', eventId: 'E-AB12CD34' });
  assert.deepEqual({ ...L.parseTriggerMessage(L.buildTriggerText('cancel', 'E-AB12CD34', ev)) }, { kind: 'cancel', eventId: 'E-AB12CD34' });
  assert.equal(L.parseTriggerMessage('こんにちは'), null);
});

test('申込返信：料金の内訳。別会場は割り勘の注記', () => {
  const ev = { title: 'ほっと一息', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'イバフォルニア・ベース', venue_fee_total: '' };
  const reg = { type: '一般', first_time: 'はい', share_declared: 'はい', fee: '500', venue_fee: '500' };
  const text = L.buildApplyReply('はなこ', ev, reg, cfg);
  assert.match(text, /当日のお支払い：500円/);
  assert.match(text, /初回/);
  assert.match(text, /発信・口コミ割引1,000円/);
  assert.doesNotMatch(text, /開催が決まった/);
  const other = { ...ev, venue: 'カフェ', venue_fee_total: '3000' };
  const t2 = L.buildApplyReply('はなこ', other, { type: 'IQ受講生', fee: '750', venue_fee: '750' }, cfg);
  assert.match(t2, /場所代750円/);
  assert.match(t2, /合計3,000円を参加者で割り勘/);
  const t3 = L.buildApplyReply('はなこ', { ...other, venue_fee_cap: '1000' }, { type: 'IQ受講生', fee: '750', venue_fee: '750' }, cfg);
  assert.match(t3, /1人1,000円まで。人数が増えると安くなります/);
});

test('運営への3日前の人数のお知らせ', () => {
  const ev = { title: 't', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'カフェ', venue_fee_total: '3000', host_name: 'はるみ' };
  const msg = L.buildAdminNoticeMessage(ev, { total: 4, guests: 2, members: 2 }, 750);
  assert.match(msg, /合計4名/);
  assert.match(msg, /1人750円/);
});

test('お知らせ後の変更：運営向けとホスト向けで文面が変わる', () => {
  const ev = { title: 't', date: '2026-12-08', start_time: '13:00' };
  const counts = { total: 5, guests: 3, members: 2 };
  assert.match(L.buildChangeMessage('apply', ev, 'はなこ', counts, false), /管理者通知[\s\S]*会場予約/);
  assert.match(L.buildChangeMessage('apply', ev, 'はなこ', counts, true), /ホストのあなたへ[\s\S]*申込状況/);
});

test('お礼（本編のあと）：割引申告の有無で文面が変わる', () => {
  const ev = { title: 't', date: '2026-12-08' };
  assert.match(L.buildThanksMessage('a', ev, cfg, true), /ここからの時間に/);
  assert.match(L.buildThanksMessage('a', ev, cfg, false), /もしよければ/);
});

test('グランドルールに「相手の話を最後まで聴ききる」', () => {
  assert.ok(L.GROUND_RULES.includes('相手の話を最後まで聴ききる'));
});

test('型：表記から探せる・作品名の案内', () => {
  assert.equal(L.findFormat('共感セッション').key, 'empathy');
  assert.equal(L.findFormat('movie').label, '映画シェア会');
  assert.equal(L.findFormat('なにか'), null);
  assert.match(L.workLine({ format: '映画シェア会', work_title: 'ちひろさん' }), /映画『ちひろさん』を事前に観て/);
  assert.match(L.workLine({ format: '読書会', work_title: '本' }), /持っていなくて大丈夫/);
  const lines = L.eventLines({ format: '読書会', work_title: '本', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'v' });
  assert.match(lines, /^🌿 木陰の読書会｜ここち/);
});

test('名前：木陰の◯◯会｜ここち（型で入れ替わる）', () => {
  assert.equal(L.seriesName({ format: '共感セッション' }), '木陰の対話会');
  assert.equal(L.seriesName({ format: '読書会' }), '木陰の読書会');
  assert.equal(L.seriesName({ format: '映画シェア会' }), '木陰の映画シェア会');
  assert.equal(L.seriesName({ format: '自己理解ワークショップ' }), '木陰のワークショップ');
  assert.equal(L.seriesName({ format: '' }), '木陰の対話会');
  const lines = L.eventLines({ format: '共感セッション', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'v' });
  assert.match(lines, /^🌿 木陰の対話会｜ここち（共感セッション）/);
});

test('3日前のリマインド：日時・料金・グランドルール', () => {
  const ev = { title: 'ほっと一息', format: '読書会', date: '2026-12-08', start_time: '13:00', end_time: '16:00', venue: 'カフェ', venue_fee_total: '3000', venue_fee_cap: '1000', host_user_id: 'UH' };
  const msg = L.buildReminderMessage('はなこ', ev, { line_user_id: 'U1', type: '一般', first_time: 'はい', share_declared: 'いいえ', fee: '2000', venue_fee: '1000' }, cfg);
  assert.match(msg, /3日後は木陰です/);
  assert.match(msg, /当日のお支払い：2,000円/);
  assert.match(msg, /1人1,000円まで/);
  assert.match(msg, /相手の話を最後まで聴ききる/);
  const hostMsg = L.buildReminderMessage('ホスト', ev, { line_user_id: 'UH', type: 'IQ受講生', fee: '2000', venue_fee: '2000' }, cfg);
  assert.match(hostMsg, /足りない分をホストが負担/);
});
