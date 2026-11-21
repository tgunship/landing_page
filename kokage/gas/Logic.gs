/**
 * 木陰 — ビジネスロジック（純粋関数のみ）
 * Google のサービス（SpreadsheetApp など）に依存しないため、Node.js でテストできます。
 * kokage/tests/logic.test.js を参照。
 */

var ROLE = { GUEST: 'guest', IQ: 'iq' };

// スプレッドシート上の表記（手で書き換えやすいよう日本語）
var ROLE_LABEL = { guest: '一般', iq: 'IQ受講生' };
var REG_TYPE = { HOST: 'ホスト', IQ: 'IQ受講生', GUEST: '一般' };
// 最少人数・中止の概念はない。募集中 → 終了 のみ
var EVENT_STATUS = { OPEN: '募集中', DONE: '終了' };
var REG_STATUS = { ACTIVE: '申込', CANCELLED: 'キャンセル' };

var GROUND_RULES = [
  '人のことも自分のことも、評価・判断しない',
  'アドバイスしない（ただ受け取り合う）',
  '相手の話を最後まで聴ききる',
  'ここで聞いた話は、外に持ち出さない',
  '安心して自分の内面とつながる時間を大切にする'
];

/**
 * 木陰の型（フォーマット）。スプレッドシートの「型」列には label が入る。
 * guide は Gemini が文章を書くときの説明。work は作品名（本・映画）の扱い。
 */
var FORMATS = [
  {
    key: 'empathy', label: '共感セッション', series: '木陰の対話会', kicker: '共感セッション',
    guide: 'ホストがいま抱えている悩み・痛みを起点にする場。チェックインのあと、ホスト→共鳴した参加者の順に、ひとり45分の紐解きセッションを2人行う。セッションのあとは全員がニーズ（願い）カードを1枚選び、一言書いて話した人に贈る。アドバイスはせず、相手の話を最後まで聴ききり、共鳴することで、自分の番が来なかった人も自分の内面に触れられる。最後にチェックアウト。',
    work: null
  },
  {
    key: 'workshop', label: '自己理解ワークショップ', series: '木陰のワークショップ', kicker: '自己理解',
    guide: '『メンタルモデルワークブック』やインナークエストのワーク（紐解き以外）を、みんなでやってみる場。枠組みがあるので、安心して自分の内面を客観的に眺められる。',
    work: null
  },
  {
    key: 'reading', label: '読書会', series: '木陰の読書会', kicker: '',
    guide: '1冊の本を真ん中に置き、順番に声に出して回し読みする（30分・1章くらい）。本は持っていなくてよく、手ぶらで参加できる。読んだあと、感じたことをシェアして対話する。',
    work: { label: '本のタイトル', required: false }
  },
  {
    key: 'movie', label: '映画シェア会', series: '木陰の映画シェア会', kicker: '',
    guide: '同じ映画を事前に観てきて、感じたこと・心が動いたところをシェアして対話する。感想を語るうちに、自分の内側（大切にしていること・痛み・願い）が見えてくる。',
    work: { label: '映画のタイトル', required: true }
  },
  {
    key: 'other', label: 'その他', series: '木陰の対話会', kicker: '',
    guide: '型にとらわれない自由な企画（海辺の散歩、お茶を飲みながら話す会など）。',
    work: null
  }
];

function findFormat(value) {
  var s = String(value || '').trim();
  for (var i = 0; i < FORMATS.length; i++) {
    if (FORMATS[i].key === s || FORMATS[i].label === s) return FORMATS[i];
  }
  return null;
}

var BRAND_SUFFIX = 'ここち';

/** 表に出す名前：「木陰の読書会｜ここち」の「木陰の読書会」の部分 */
function seriesName(ev) {
  var f = findFormat(ev.format);
  return (f && f.series) || '木陰の対話会';
}

/** 作品名の案内（読書会・映画シェア会） */
function workLine(ev) {
  var f = findFormat(ev.format);
  if (!f || !ev.work_title) return '';
  if (f.key === 'movie') return '🎬 映画『' + ev.work_title + '』を事前に観てきてください';
  if (f.key === 'reading') return '📖 本『' + ev.work_title + '』（回し読みするので、持っていなくて大丈夫です）';
  return '';
}

/** スプレッドシートの「区分」セルを内部ロールへ。表記ゆれを許容する（LQメンバーもIQ受講生）。 */
function normalizeRole(value) {
  var s = String(value || '').trim().toLowerCase();
  if (!s) return ROLE.GUEST;
  if (s.indexOf('iq') >= 0 || s.indexOf('受講') >= 0 || s.indexOf('インナー') >= 0 ||
      s.indexOf('lq') >= 0 || s.indexOf('member') >= 0 || s.indexOf('メンバー') >= 0 || s.indexOf('ライフ') >= 0) return ROLE.IQ;
  return ROLE.GUEST;
}

function regTypeForRole(role) {
  return role === ROLE.IQ ? REG_TYPE.IQ : REG_TYPE.GUEST;
}

function isGuestType(type) {
  return String(type || '').trim() === REG_TYPE.GUEST;
}

function toBool(value) {
  var s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === 'はい' || s === '○' || s === '◯' || s === '1' || s === 'yes' || s === 'y';
}

function boolLabel(b) { return b ? 'はい' : 'いいえ'; }

// ---------- 料金 ----------

/** 別会場（場所代を割り勘）の回か */
function isSplitVenue(ev) {
  return String(ev.venue_fee_total == null ? '' : ev.venue_fee_total).trim() !== '';
}

/**
 * 1人あたりの場所代（ホスト以外）。
 * - イバフォルニア・ベース（既定）：1人500円
 * - 別会場：場所代の合計を、運営以外の参加者（申込シートの有効な申込）の人数で割り勘（10円単位で切り上げ）。
 *   ただし打ち合わせで決めた「1人あたりの上限」を超えない。足りない分はホストが負担する。
 */
function venueShare(ev, headcount, cfg) {
  if (!isSplitVenue(ev)) return cfg.VENUE_FEE;
  var total = Number(ev.venue_fee_total) || 0;
  if (total <= 0) return 0;
  var n = Math.max(1, headcount || 0);
  var share = Math.ceil(total / n / 10) * 10;
  var cap = Number(ev.venue_fee_cap) || 0;
  return cap > 0 ? Math.min(share, cap) : share;
}

/**
 * ホストの場所代（別会場）：合計から、ほかの参加者の分を引いた残り（上限で足りない分・端数はホストが負担）。
 * イバフォルニア・ベースはほかの人と同じ1人500円。
 */
function hostVenueFee(ev, headcount, cfg) {
  if (!isSplitVenue(ev)) return cfg.VENUE_FEE;
  var total = Number(ev.venue_fee_total) || 0;
  var n = Math.max(1, headcount || 0);
  return Math.max(0, total - venueShare(ev, n, cfg) * (n - 1));
}

/** その申込の場所代（ホストかどうかで変わる） */
function venueFeeFor(ev, headcount, isHost, cfg) {
  return isHost ? hostVenueFee(ev, headcount, cfg) : venueShare(ev, headcount, cfg);
}

/**
 * 参加費（場所代を除く）。ホストかどうかには関係なく、区分で決まる。
 * - IQ受講生：0円
 * - 一般 初回: 1,000円、2回目以降: 6,000円。発信・口コミの自己申告で1,000円引き（0円未満にはならない）
 */
function participationFee(opts, cfg) {
  if (opts.role === ROLE.IQ) return { base: 0, discount: 0, fee: 0 };
  var base = opts.isFirstTime ? cfg.GUEST_FIRST_FEE : cfg.GUEST_REGULAR_FEE;
  var discount = opts.shareDeclared ? Math.min(cfg.ACTION_DISCOUNT_AMOUNT, base) : 0;
  return { base: base, discount: discount, fee: base - discount };
}

/** 申込行（スプレッドシート）の区分・初回・割引から参加費を出す */
function participationFeeOfReg(reg, cfg) {
  if (String(reg.type).trim() === REG_TYPE.HOST) return 0; // 古い行（区分「ホスト」）の扱い
  return participationFee({
    role: isGuestType(reg.type) ? ROLE.GUEST : ROLE.IQ,
    isFirstTime: toBool(reg.first_time),
    shareDeclared: toBool(reg.share_declared)
  }, cfg).fee;
}

/**
 * 一般参加者が「初回」かどうか。
 * 他の回（募集中・終了）に「一般」として有効な申込が1件でもあれば2回目以降扱い。
 */
function isFirstTimeGuest(userId, registrations, eventsById, excludeEventId) {
  for (var i = 0; i < registrations.length; i++) {
    var r = registrations[i];
    if (r.line_user_id !== userId) continue;
    if (r.event_id === excludeEventId) continue;
    if (r.status !== REG_STATUS.ACTIVE) continue;
    if (!isGuestType(r.type)) continue;
    var ev = eventsById[r.event_id];
    if (!ev || !isCountedStatus(ev.status)) continue;
    return false;
  }
  return true;
}

function isCountedStatus(status) {
  return status === EVENT_STATUS.OPEN || status === EVENT_STATUS.DONE;
}

/**
 * 一般参加者の「初回」料金をどの申込に割り当てるか。
 * 有効な「一般」申込のうち、いちばん先に申し込んだもの1件だけが初回。
 * 戻り値: { 申込ID: true/false } → 初回の申込をキャンセルしたら、次の申込が自動で初回に戻る。
 */
function firstTimeAssignments(userId, registrations, eventsById) {
  var mine = registrations.filter(function (r) {
    if (r.line_user_id !== userId || r.status !== REG_STATUS.ACTIVE || !isGuestType(r.type)) return false;
    var ev = eventsById[r.event_id];
    return !!ev && isCountedStatus(ev.status);
  }).sort(function (a, b) {
    return String(a.created_at).localeCompare(String(b.created_at)) || (a._row || 0) - (b._row || 0);
  });
  var out = {};
  mine.forEach(function (r, i) { out[r.reg_id] = i === 0; });
  return out;
}

/** イベントの有効な申込から人数を数える（運営は申込シートにいないので数えない） */
function countParticipants(eventId, registrations) {
  var total = 0, guests = 0;
  for (var i = 0; i < registrations.length; i++) {
    var r = registrations[i];
    if (r.event_id !== eventId || r.status !== REG_STATUS.ACTIVE) continue;
    total++;
    if (isGuestType(r.type)) guests++;
  }
  return { total: total, guests: guests, members: total - guests };
}

// ---------- 日付・時刻 ----------

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** "2026-12-01" / "2026/12/1" → {y,m,d} */
function parseDateParts(s) {
  var m = String(s || '').trim().match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** "13:00" → {h, min} */
function parseTimeParts(s) {
  var m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { h: +m[1], min: +m[2] };
}

/** スクリプトのタイムゾーン（Asia/Tokyo）でのローカル日時 */
function makeDate(dateStr, timeStr) {
  var d = parseDateParts(dateStr);
  if (!d) return null;
  var t = parseTimeParts(timeStr) || { h: 0, min: 0 };
  return new Date(d.y, d.m - 1, d.d, t.h, t.min, 0, 0);
}

function normalizeDate(s) {
  var d = parseDateParts(s);
  return d ? d.y + '-' + pad2(d.m) + '-' + pad2(d.d) : '';
}

function normalizeTime(s) {
  var t = parseTimeParts(s);
  return t ? pad2(t.h) + ':' + pad2(t.min) : '';
}

function addHoursToTime(timeStr, hours) {
  var t = parseTimeParts(timeStr);
  if (!t) return '';
  var total = t.h * 60 + t.min + Math.round(hours * 60);
  return pad2(Math.floor(total / 60) % 24) + ':' + pad2(total % 60);
}

function eventStart(ev) { return makeDate(ev.date, ev.start_time); }
function eventEnd(ev) { return makeDate(ev.date, ev.end_time || addHoursToTime(ev.start_time, 3)); }

/** 前半（本編）が終わる時刻：開始＋CORE_HOURS（2時間） */
function coreEnd(ev, cfg) {
  var s = eventStart(ev);
  return s ? new Date(s.getTime() + cfg.CORE_HOURS * 3600 * 1000) : null;
}

/** 運営への「人数のお知らせ」を送る日時（開催日のN日前・指定時刻） */
function noticeTimeOf(ev, cfg) {
  var d = parseDateParts(ev.date);
  if (!d) return null;
  return new Date(d.y, d.m - 1, d.d - cfg.NOTICE_DAYS_BEFORE, cfg.NOTICE_HOUR, 0, 0, 0);
}

function shouldNoticeNow(ev, now, cfg) {
  if (ev.status !== EVENT_STATUS.OPEN || ev.decided_at) return false;
  var t = noticeTimeOf(ev, cfg);
  return !!t && now.getTime() >= t.getTime();
}

/** お礼（感想の投稿のお願い）は本編2時間が終わったとき＝後半1時間の投稿・フリートークの時間に合わせる */
function shouldThankNow(ev, now, cfg) {
  if (!isCountedStatus(ev.status) || ev.thanks_sent_at) return false;
  var t = coreEnd(ev, cfg);
  return !!t && now.getTime() >= t.getTime();
}

function shouldFinishNow(ev, now) {
  if (ev.status !== EVENT_STATUS.OPEN) return false;
  var end = eventEnd(ev);
  return !!end && now.getTime() >= end.getTime();
}

/** 申込・キャンセルを受け付けられるか：「募集中」で開始時刻より前 */
function isOpenForApply(ev, now) {
  if (ev.status !== EVENT_STATUS.OPEN) return false;
  var start = eventStart(ev);
  return !!start && now.getTime() < start.getTime();
}

function isOpenForCancel(ev, now) {
  return isOpenForApply(ev, now);
}

var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-12-01" → "12月1日（火）" */
function formatJpDate(dateStr) {
  var d = parseDateParts(dateStr);
  if (!d) return String(dateStr || '');
  var w = new Date(d.y, d.m - 1, d.d).getDay();
  return d.m + '月' + d.d + '日（' + WEEKDAYS[w] + '）';
}

function formatYen(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

// ---------- LINE トリガーメッセージ ----------

/**
 * 参加者のトークから公式LINEへ送られる合図のメッセージ（LIFF の liff.sendMessages）。
 * Webhook で受けて無料の Reply API で返信する。公式LINEの受信箱にも並ぶので、運営はここで申込・キャンセルを確認できる。
 * 参加者本人のトークにも残るので、人数は載せない。
 */
function buildTriggerText(kind, eventId, ev) {
  var lines = [kind === 'cancel' ? '【木陰】キャンセルしました #' + eventId : '【木陰】申し込みました #' + eventId];
  if (ev) {
    lines.push(formatJpDate(ev.date) + ' ' + ev.start_time + '〜『' + ev.title + '』' + (ev.decided_at ? '（人数お知らせ後）' : ''));
  }
  return lines.join('\n');
}

function parseTriggerMessage(text) {
  var s = String(text || '').split('\n')[0]; // 1行目だけを見る（タイトルの文字に影響されないように）
  if (s.indexOf('【木陰】') !== 0) return null;
  var m = s.match(/#(E-[A-Za-z0-9]+)/);
  if (!m) return null;
  if (s.indexOf('キャンセル') >= 0) return { kind: 'cancel', eventId: m[1] };
  if (s.indexOf('申し込み') >= 0 || s.indexOf('申込') >= 0) return { kind: 'apply', eventId: m[1] };
  return null;
}

// ---------- メッセージ文面 ----------

function eventLines(ev) {
  var lines = [
    '📅 ' + formatJpDate(ev.date) + ' ' + ev.start_time + '〜' + ev.end_time,
    '📍 ' + ev.venue
  ];
  var f = findFormat(ev.format);
  lines.unshift('🌿 ' + seriesName(ev) + '｜' + BRAND_SUFFIX + (f && f.kicker ? '（' + f.kicker + '）' : ''));
  var w = workLine(ev);
  if (w) lines.push(w);
  return lines.join('\n');
}

function venueNote(ev, isHost) {
  if (!isSplitVenue(ev)) return '';
  var cap = Number(ev.venue_fee_cap) || 0;
  if (isHost) return '場所代は合計' + formatYen(ev.venue_fee_total) + 'を参加者で割り勘し、足りない分をホストが負担します（人数によって変わります）';
  return '場所代は合計' + formatYen(ev.venue_fee_total) + 'を参加者で割り勘' +
    (cap ? '（1人' + formatYen(cap) + 'まで。人数が増えると安くなります）' : '（人数によって変わります）');
}

function feeLines(reg, ev, cfg) {
  var isHost = !!ev.host_user_id && reg.line_user_id === ev.host_user_id;
  var fee = Number(reg.fee) || 0;
  var venue = reg.venue_fee !== undefined && reg.venue_fee !== '' ? Number(reg.venue_fee) : cfg.VENUE_FEE;
  var parts = [];
  if (isGuestType(reg.type)) {
    var first = toBool(reg.first_time);
    var p = participationFee({ role: ROLE.GUEST, isFirstTime: first, shareDeclared: toBool(reg.share_declared) }, cfg);
    parts.push('参加費' + formatYen(p.base) + (first ? '（初回）' : ''));
    if (p.discount) parts.push('− 発信・口コミ割引' + formatYen(p.discount));
    parts.push('＋ 場所代' + formatYen(venue));
  } else {
    parts.push('場所代' + formatYen(venue));
  }
  var out = '💴 当日のお支払い：' + formatYen(fee) + '\n（' + parts.join(' ') + '）';
  var note = venueNote(ev, isHost);
  return note ? out + '\n※' + note : out;
}

function buildApplyReply(name, ev, reg, cfg) {
  return [
    (name ? name + 'さん、' : '') + 'お申し込みありがとうございます🌿',
    '',
    '『' + ev.title + '』',
    eventLines(ev),
    feeLines(reg, ev, cfg),
    '',
    '当日お会いできるのを楽しみにしています。お支払いは当日会場でお願いします。',
    'ご都合が悪くなったら、メニューの「わたしの予約」からキャンセルできます。',
    '',
    '急なお知らせや木陰の様子はInstagramでもお届けしています。よかったらフォローしてくださいね。',
    cfg.INSTAGRAM_URL
  ].join('\n');
}

function buildCancelReply(name, ev, others) {
  var lines = [
    (name ? name + 'さん、' : '') + 'キャンセルを承りました。',
    '',
    '『' + ev.title + '』（' + formatJpDate(ev.date) + '）'
  ];
  if (others && others.length) {
    lines.push('', 'いまお申し込み中の木陰：');
    others.forEach(function (o) {
      lines.push('・' + formatJpDate(o.event.date) + '『' + o.event.title + '』当日のお支払い ' + formatYen(o.reg.fee));
    });
  }
  lines.push('', 'また気が向いたときに、木陰でひと息つきに来てくださいね🌿');
  return lines.join('\n');
}

/** 運営へ：開催3日前の人数のお知らせ（会場の予約・人数確認用） */
function buildAdminNoticeMessage(ev, counts, perPerson, hostFee) {
  var lines = [
    '【管理者通知｜3日前の人数】',
    formatJpDate(ev.date) + ' ' + ev.start_time + '〜' + ev.end_time,
    '『' + ev.title + '』（ホスト：' + (ev.host_name || '—') + '）',
    '📍 ' + ev.venue,
    '合計' + counts.total + '名（一般' + counts.guests + '名 / 仲間・ホスト' + counts.members + '名）※運営は含みません'
  ];
  if (isSplitVenue(ev)) {
    lines.push('場所代 合計' + formatYen(ev.venue_fee_total) + ' → いまの人数で1人' + formatYen(perPerson) +
      (hostFee !== undefined && hostFee !== null ? '・ホスト' + formatYen(hostFee) : ''));
  }
  lines.push('', '会場の予約・人数の確認をお願いします。これ以降の申込・キャンセルは公式LINEの受信箱に「（人数お知らせ後）」と付いて届きます。');
  return lines.join('\n');
}

/** 人数のお知らせ後の申込・キャンセル（forHost=true でホスト向けの文面） */
function buildChangeMessage(kind, ev, name, counts, forHost) {
  var label = kind === 'cancel' ? 'キャンセル' : '申込';
  return [
    forHost ? '【ホストのあなたへ｜' + label + 'がありました】' : '【管理者通知｜人数お知らせ後の' + label + '】',
    formatJpDate(ev.date) + ' ' + ev.start_time + '〜『' + ev.title + '』',
    (name || '参加者') + 'さんが' + (kind === 'cancel' ? 'キャンセルしました。' : '申し込みました。'),
    '現在 合計' + counts.total + '名（一般' + counts.guests + '名 / 仲間・ホスト' + counts.members + '名）',
    forHost ? '申込状況はメニューの「申込状況」から見られます。' : '会場予約の人数をご確認ください。'
  ].join('\n');
}

/** 参加者へ：開催3日前のリマインド */
function buildReminderMessage(name, ev, reg, cfg) {
  return [
    '【3日後は木陰です🌿】',
    (name ? name + 'さん、' : '') + 'お申し込みいただいている木陰が近づいてきました。',
    '',
    '『' + ev.title + '』',
    eventLines(ev),
    feeLines(reg, ev, cfg) + '（当日会場でお支払いください）',
    '',
    '前半2時間はテーマに沿ってじっくり、後半1時間は感想の投稿やフリートークの時間です。',
    '木陰のグランドルール：',
    GROUND_RULES.map(function (r) { return '・' + r; }).join('\n'),
    '',
    'ご都合が悪くなった場合は、メニューの「わたしの予約」からキャンセルできます。当日お会いできるのを楽しみにしています。'
  ].join('\n');
}

/** 本編2時間が終わったところで：感想の投稿のお願い（後半1時間は投稿・フリートークの時間） */
function buildThanksMessage(name, ev, cfg, shareDeclared) {
  var lines = [
    (name ? name + 'さん、' : '') + '今日は木陰に来てくださって、ありがとうございます🌿',
    ''
  ];
  if (shareDeclared) {
    lines.push('ここからの時間に、今日感じたことをInstagramや口コミでシェアしてくださいね。');
  } else {
    lines.push('もしよければ、ここからの時間に、今日感じたことをInstagramや口コミでシェアしてもらえると嬉しいです。');
  }
  lines.push('Instagramでは ' + cfg.INSTAGRAM_HANDLE + ' をメンションしていただけると、うってぃがとても喜びます！');
  lines.push(cfg.INSTAGRAM_URL);
  lines.push('', 'また、ふうっと一息つきたくなったら、いつでも木陰へ。');
  return lines.join('\n');
}

// Node.js（テスト）から読み込めるようにする
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FORMATS: FORMATS, GROUND_RULES: GROUND_RULES, findFormat: findFormat, workLine: workLine, eventLines: eventLines,
    ROLE: ROLE, ROLE_LABEL: ROLE_LABEL, REG_TYPE: REG_TYPE, EVENT_STATUS: EVENT_STATUS, REG_STATUS: REG_STATUS,
    normalizeRole: normalizeRole, regTypeForRole: regTypeForRole, isGuestType: isGuestType, toBool: toBool,
    isSplitVenue: isSplitVenue, venueShare: venueShare, hostVenueFee: hostVenueFee, venueFeeFor: venueFeeFor,
    seriesName: seriesName, buildReminderMessage: buildReminderMessage, participationFee: participationFee, participationFeeOfReg: participationFeeOfReg,
    isFirstTimeGuest: isFirstTimeGuest, firstTimeAssignments: firstTimeAssignments, countParticipants: countParticipants,
    makeDate: makeDate, normalizeDate: normalizeDate, normalizeTime: normalizeTime, addHoursToTime: addHoursToTime,
    coreEnd: coreEnd, noticeTimeOf: noticeTimeOf, shouldNoticeNow: shouldNoticeNow, shouldThankNow: shouldThankNow,
    shouldFinishNow: shouldFinishNow, isOpenForApply: isOpenForApply, isOpenForCancel: isOpenForCancel,
    formatJpDate: formatJpDate, formatYen: formatYen,
    buildTriggerText: buildTriggerText, parseTriggerMessage: parseTriggerMessage, feeLines: feeLines,
    buildApplyReply: buildApplyReply, buildCancelReply: buildCancelReply,
    buildAdminNoticeMessage: buildAdminNoticeMessage, buildChangeMessage: buildChangeMessage,
    buildThanksMessage: buildThanksMessage
  };
}
