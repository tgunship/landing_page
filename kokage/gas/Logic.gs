/**
 * 木陰 — ビジネスロジック（純粋関数のみ）
 * Google のサービス（SpreadsheetApp など）に依存しないため、Node.js でテストできます。
 * kokage/tests/logic.test.js を参照。
 */

var ROLE = { GUEST: 'guest', MEMBER: 'member', IQ: 'iq' };

// スプレッドシート上の表記（手で書き換えやすいよう日本語）
var ROLE_LABEL = { guest: '一般', member: 'LQメンバー', iq: 'IQ受講生' };
var REG_TYPE = { HOST: 'ホスト', MEMBER: 'LQメンバー', IQ: 'IQ受講生', GUEST: '一般' };
var EVENT_STATUS = { OPEN: '募集中', GO: '開催決定', CANCELLED: '中止', DONE: '終了' };
var REG_STATUS = { ACTIVE: '申込', CANCELLED: 'キャンセル' };

/**
 * 木陰の型（フォーマット）。スプレッドシートの「型」列には label が入る。
 * guide は Gemini が文章を書くときの説明。work は作品名（本・映画）の扱い。
 */
var FORMATS = [
  {
    key: 'empathy', label: '共感セッション',
    guide: 'ホスト（ライフクエストのメンバー）がいま抱えている悩み・痛みを起点にする場。チェックインのあと、ホスト→共鳴した参加者の順に、ひとり20〜30分の紐解きセッションを2〜3人行う。セッションのあとは全員がニーズ（願い）カードを1枚選び、一言書いて話した人に贈る。アドバイスはせず、聴くこと・共鳴することで、自分の番が来なかった人も自分の内面に触れられる。最後にチェックアウト、残りはフリートーク。',
    work: null
  },
  {
    key: 'workshop', label: '自己理解ワークショップ',
    guide: '『メンタルモデルワークブック』やインナークエストのワーク（紐解き以外）を、みんなでやってみる場。枠組みがあるので、安心して自分の内面を客観的に眺められる。',
    work: null
  },
  {
    key: 'reading', label: '読書会',
    guide: '1冊の本を真ん中に置き、順番に声に出して回し読みする（30分・1章くらい）。本は持っていなくてよく、手ぶらで参加できる。読んだあと、感じたことをシェアして対話する。',
    work: { label: '本のタイトル', required: false }
  },
  {
    key: 'movie', label: '映画シェア会',
    guide: '同じ映画を事前に観てきて、感じたこと・心が動いたところをシェアして対話する。感想を語るうちに、自分の内側（大切にしていること・痛み・願い）が見えてくる。',
    work: { label: '映画のタイトル', required: true }
  },
  {
    key: 'other', label: 'その他',
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

/** 作品名の案内（読書会・映画シェア会） */
function workLine(ev) {
  var f = findFormat(ev.format);
  if (!f || !ev.work_title) return '';
  if (f.key === 'movie') return '🎬 映画『' + ev.work_title + '』を事前に観てきてください';
  if (f.key === 'reading') return '📖 本『' + ev.work_title + '』（回し読みするので、持っていなくて大丈夫です）';
  return '';
}

/** スプレッドシートの「区分」セルを内部ロールへ。表記ゆれを許容する。 */
function normalizeRole(value) {
  var s = String(value || '').trim().toLowerCase();
  if (!s) return ROLE.GUEST;
  if (s.indexOf('lq') >= 0 || s.indexOf('member') >= 0 || s.indexOf('メンバー') >= 0 || s.indexOf('ライフ') >= 0) return ROLE.MEMBER;
  if (s.indexOf('iq') >= 0 || s.indexOf('受講') >= 0 || s.indexOf('インナー') >= 0) return ROLE.IQ;
  return ROLE.GUEST;
}

function regTypeForRole(role) {
  if (role === ROLE.MEMBER) return REG_TYPE.MEMBER;
  if (role === ROLE.IQ) return REG_TYPE.IQ;
  return REG_TYPE.GUEST;
}

function isGuestType(type) {
  return String(type || '').trim() === REG_TYPE.GUEST;
}

function toBool(value) {
  var s = String(value == null ? '' : value).trim().toLowerCase();
  return s === 'true' || s === 'はい' || s === '○' || s === '◯' || s === '1' || s === 'yes' || s === 'y';
}

function boolLabel(b) { return b ? 'はい' : 'いいえ'; }

/**
 * 料金計算。
 * - LQメンバー / IQ受講生（ホスト含む）: 参加費0円 + 場所代
 * - 一般 初回: 1,000円 + 場所代、2回目以降: 6,000円 + 場所代
 * - 一般のみ、発信・口コミの自己申告で参加費から割引（参加費が0円未満にはならない）
 */
function calcFee(opts, cfg) {
  var role = opts.role;
  var venueFee = cfg.VENUE_FEE;
  if (role === ROLE.MEMBER || role === ROLE.IQ) {
    return { participationFee: 0, discount: 0, venueFee: venueFee, total: venueFee, first: false };
  }
  var base = opts.isFirstTime ? cfg.GUEST_FIRST_FEE : cfg.GUEST_REGULAR_FEE;
  var discount = opts.shareDeclared ? Math.min(cfg.ACTION_DISCOUNT_AMOUNT, base) : 0;
  return {
    participationFee: base,
    discount: discount,
    venueFee: venueFee,
    total: base - discount + venueFee,
    first: !!opts.isFirstTime
  };
}

/**
 * 一般参加者が「初回」かどうか。
 * 他のイベント（中止になったものを除く）に「一般」として有効な申込が1件でもあれば2回目以降扱い。
 * （＝初回料金は1回だけ。中止になった回は数えない）
 */
function isFirstTimeGuest(userId, registrations, eventsById, excludeEventId) {
  for (var i = 0; i < registrations.length; i++) {
    var r = registrations[i];
    if (r.line_user_id !== userId) continue;
    if (r.event_id === excludeEventId) continue;
    if (r.status !== REG_STATUS.ACTIVE) continue;
    if (!isGuestType(r.type)) continue;
    var ev = eventsById[r.event_id];
    if (!ev) continue;
    if (ev.status === EVENT_STATUS.CANCELLED) continue;
    return false;
  }
  return true;
}

/** イベントの有効な申込から人数を数える */
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

function isGo(counts, cfg) {
  return counts.total >= cfg.MIN_TOTAL_PARTICIPANTS && counts.guests >= cfg.MIN_GUEST_PARTICIPANTS;
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

/** 開催判定を行う日時（開催日のN日前・指定時刻） */
function decisionTimeOf(ev, cfg) {
  var d = parseDateParts(ev.date);
  if (!d) return null;
  return new Date(d.y, d.m - 1, d.d - cfg.GO_NOGO_DAYS_BEFORE, cfg.GO_NOGO_HOUR, 0, 0, 0);
}

function shouldDecideNow(ev, now, cfg) {
  if (ev.status !== EVENT_STATUS.OPEN) return false;
  var t = decisionTimeOf(ev, cfg);
  return !!t && now.getTime() >= t.getTime();
}

function eventStart(ev) { return makeDate(ev.date, ev.start_time); }
function eventEnd(ev) { return makeDate(ev.date, ev.end_time || addHoursToTime(ev.start_time, 3)); }

function shouldFinishNow(ev, now) {
  if (ev.status !== EVENT_STATUS.GO) return false;
  var end = eventEnd(ev);
  return !!end && now.getTime() >= end.getTime();
}

/**
 * 新しい申込を受け付けられるか：「募集中」「開催決定」で開始時刻より前。
 * （開催判定の後も、開催が決まった回には当日の開始まで申し込める）
 */
function isOpenForApply(ev, now) {
  return isOpenForCancel(ev, now);
}

/** キャンセルを受け付けられるか：「募集中」「開催決定」で開始時刻より前 */
function isOpenForCancel(ev, now) {
  if (ev.status !== EVENT_STATUS.OPEN && ev.status !== EVENT_STATUS.GO) return false;
  var start = eventStart(ev);
  return !!start && now.getTime() < start.getTime();
}

/**
 * 一般参加者の「初回」料金をどの申込に割り当てるか。
 * 中止になっていない回への有効な「一般」申込のうち、いちばん先に申し込んだもの1件だけが初回。
 * 戻り値: { 申込ID: true/false }
 * → 初回の回が中止・キャンセルになったら、次の申込が自動で初回に戻る。
 */
function firstTimeAssignments(userId, registrations, eventsById) {
  var mine = registrations.filter(function (r) {
    if (r.line_user_id !== userId || r.status !== REG_STATUS.ACTIVE || !isGuestType(r.type)) return false;
    var ev = eventsById[r.event_id];
    return !!ev && ev.status !== EVENT_STATUS.CANCELLED;
  }).sort(function (a, b) {
    return String(a.created_at).localeCompare(String(b.created_at)) || (a._row || 0) - (b._row || 0);
  });
  var out = {};
  mine.forEach(function (r, i) { out[r.reg_id] = i === 0; });
  return out;
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
 * LIFF の liff.sendMessages() で利用者のトークから送られる合図のメッセージ。
 * これを Webhook で受け取り、無料の Reply API で返信する。
 */
/**
 * 参加者のトークから公式LINEへ送られる合図のメッセージ。
 * 公式LINEの受信箱（LINE Official Account Manager のチャット）にそのまま並ぶので、
 * 運営はここで申込・キャンセルと現在の人数を無料で確認できる。
 */
function buildTriggerText(kind, eventId, ev) {
  var lines = [kind === 'cancel' ? '【木陰】キャンセルしました #' + eventId : '【木陰】申し込みました #' + eventId];
  if (ev) {
    lines.push(formatJpDate(ev.date) + ' ' + ev.start_time + '〜『' + ev.title + '』' + (ev.status === EVENT_STATUS.GO ? '（開催決定済み）' : ''));
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
  if (f && f.key !== 'other') lines.unshift('🌿 ' + f.label);
  var w = workLine(ev);
  if (w) lines.push(w);
  return lines.join('\n');
}

function feeLines(reg, cfg) {
  var fee = Number(reg.fee) || 0;
  if (!isGuestType(reg.type)) {
    return '💴 当日のお支払い：' + formatYen(fee) + '（場所代）';
  }
  var first = toBool(reg.first_time);
  var share = toBool(reg.share_declared);
  var base = first ? cfg.GUEST_FIRST_FEE : cfg.GUEST_REGULAR_FEE;
  var detail = '参加費' + formatYen(base) + (first ? '（初回）' : '');
  if (share) detail += ' − 発信・口コミ割引' + formatYen(Math.min(cfg.ACTION_DISCOUNT_AMOUNT, base));
  detail += ' ＋ 場所代' + formatYen(cfg.VENUE_FEE);
  return '💴 当日のお支払い：' + formatYen(fee) + '\n（' + detail + '）';
}

function buildApplyReply(name, ev, reg, cfg) {
  var lines = [
    (name ? name + 'さん、' : '') + 'お申し込みありがとうございます🌿',
    '',
    '『' + ev.title + '』',
    eventLines(ev),
    feeLines(reg, cfg),
    ''
  ];
  if (ev.status === EVENT_STATUS.GO) {
    lines.push('この回はすでに開催が決まっています。当日お会いできるのを楽しみにしています。');
  } else {
    lines.push('開催' + cfg.GO_NOGO_DAYS_BEFORE + '日前の' + cfg.GO_NOGO_HOUR + '時ごろに、開催が決まったかどうかをこのLINEでお知らせします。');
  }
  lines.push('');
  lines.push('急なお知らせや木陰の様子はInstagramでもお届けしています。よかったらフォローしてくださいね。');
  lines.push(cfg.INSTAGRAM_URL);
  return lines.join('\n');
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

/** 料金が「初回」に戻った申込のお知らせ文（中止のお知らせに添える） */
function buildFeeChangeNote(changes) {
  if (!changes || !changes.length) return '';
  return ['', 'なお、お申し込み中の次の木陰は、はじめての方の料金になりました。']
    .concat(changes.map(function (c) {
      return '・' + formatJpDate(c.event.date) + '『' + c.event.title + '』当日のお支払い ' + formatYen(c.fee);
    })).join('\n');
}

function buildGoMessage(name, ev, reg, cfg) {
  return [
    '【開催決定🌿】',
    (name ? name + 'さん、' : '') + '『' + ev.title + '』の開催が決まりました！',
    '',
    eventLines(ev),
    feeLines(reg, cfg) + '（当日会場でお支払いください）',
    '',
    '前半2時間はテーマに沿ったじっくりの時間、後半1時間はゆるやかなフリータイムです。',
    '「評価・判断しない」「アドバイスしない」「ここで聞いた話は外に持ち出さない」を大切に、安心してお過ごしください。',
    '',
    'ご都合が悪くなった場合は、メニューの「わたしの予約」からキャンセルできます。'
  ].join('\n');
}

function buildNoGoMessage(name, ev, note) {
  return [
    '【開催見送りのお知らせ】',
    (name ? name + 'さん、' : '') + '『' + ev.title + '』（' + formatJpDate(ev.date) + '）は、今回は最少催行人数に達しなかったため、開催を見送ることになりました。',
    '',
    'お申し込みいただいたこと、とても嬉しかったです。また別の日程でご案内できたときは、ぜひ木陰に遊びに来てくださいね🌿'
  ].join('\n') + (note || '');
}

function buildAdminGoMessage(ev, counts) {
  return [
    '【管理者通知｜開催決定】',
    formatJpDate(ev.date) + ' ' + ev.start_time + '〜' + ev.end_time,
    '『' + ev.title + '』',
    '合計' + counts.total + '名（一般' + counts.guests + '名 / メンバー' + counts.members + '名）',
    '',
    ev.venue + 'の予約（' + counts.total + '名分＋運営）をお願いします。'
  ].join('\n');
}

function buildAdminNoGoMessage(ev, counts) {
  return [
    '【管理者通知｜中止処理完了】',
    formatJpDate(ev.date) + '『' + ev.title + '』',
    '合計' + counts.total + '名（一般' + counts.guests + '名 / メンバー' + counts.members + '名）で条件未達のため、自動で中止にし、申込者へLINEで通知しました。',
    '',
    '別日で再企画すると、今回申し込んでくれた一般の方へ自動で特別ご案内が届きます。'
  ].join('\n');
}

/** 開催決定後の追加申込・キャンセルのお知らせ（forHost=true でホスト向けの文面） */
function buildAdminChangeMessage(kind, ev, name, counts, forHost) {
  var label = kind === 'cancel' ? 'キャンセル' : '追加申込';
  var lines = [
    forHost ? '【ホストのあなたへ｜' + label + 'がありました】' : '【管理者通知｜開催決定後の' + label + '】',
    formatJpDate(ev.date) + ' ' + ev.start_time + '〜『' + ev.title + '』',
    (name || '参加者') + 'さんが' + (kind === 'cancel' ? 'キャンセルしました。' : '申し込みました。'),
    '現在 合計' + counts.total + '名（一般' + counts.guests + '名 / メンバー' + counts.members + '名）'
  ];
  lines.push(forHost ? '申込状況はメニューの「申込状況」から見られます。' : '会場予約の人数をご確認ください。');
  return lines.join('\n');
}

function buildThanksMessage(name, ev, cfg, shareDeclared) {
  var lines = [
    (name ? name + 'さん、' : '') + '本日は木陰にお越しいただき、ありがとうございました🌿',
    ''
  ];
  if (shareDeclared) {
    lines.push('今日感じたことを、ぜひInstagramや口コミでシェアしてくださいね。');
  } else {
    lines.push('もしよければ、今日感じたことをInstagramや口コミでシェアしてもらえると嬉しいです。');
  }
  lines.push('Instagramでは ' + cfg.INSTAGRAM_HANDLE + ' をメンションしていただけると、うってぃがとても喜びます！');
  lines.push(cfg.INSTAGRAM_URL);
  lines.push('', 'また、ふうっと一息つきたくなったら、いつでも木陰へ。');
  return lines.join('\n');
}

function buildRevengeMessage(name, newEv, link) {
  return [
    (name ? name + 'さん、' : '') + 'こんにちは🌿',
    '',
    '先日、人数の都合で見送りとなってしまった木陰ですが、別の日程での開催が決まり、募集がはじまりました。',
    '',
    '『' + newEv.title + '』',
    eventLines(newEv),
    '',
    'お申し込みくださった' + (name ? name + 'さん' : 'あなた') + 'に、いちばんにお知らせしたくてご連絡しました。ご都合が合えば、ぜひお待ちしています。',
    link
  ].join('\n');
}

// Node.js（テスト）から読み込めるようにする
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FORMATS: FORMATS, findFormat: findFormat, workLine: workLine, eventLines: eventLines,
    ROLE: ROLE, ROLE_LABEL: ROLE_LABEL, REG_TYPE: REG_TYPE, EVENT_STATUS: EVENT_STATUS, REG_STATUS: REG_STATUS,
    normalizeRole: normalizeRole, regTypeForRole: regTypeForRole, isGuestType: isGuestType, toBool: toBool,
    calcFee: calcFee, isFirstTimeGuest: isFirstTimeGuest, countParticipants: countParticipants, isGo: isGo,
    makeDate: makeDate, normalizeDate: normalizeDate, normalizeTime: normalizeTime, addHoursToTime: addHoursToTime,
    decisionTimeOf: decisionTimeOf, shouldDecideNow: shouldDecideNow, shouldFinishNow: shouldFinishNow,
    isOpenForApply: isOpenForApply, isOpenForCancel: isOpenForCancel,
    firstTimeAssignments: firstTimeAssignments, buildFeeChangeNote: buildFeeChangeNote, formatJpDate: formatJpDate, formatYen: formatYen,
    buildTriggerText: buildTriggerText, parseTriggerMessage: parseTriggerMessage,
    buildApplyReply: buildApplyReply, buildCancelReply: buildCancelReply, buildGoMessage: buildGoMessage,
    buildNoGoMessage: buildNoGoMessage, buildAdminGoMessage: buildAdminGoMessage,
    buildAdminNoGoMessage: buildAdminNoGoMessage, buildAdminChangeMessage: buildAdminChangeMessage,
    buildThanksMessage: buildThanksMessage, buildRevengeMessage: buildRevengeMessage
  };
}
