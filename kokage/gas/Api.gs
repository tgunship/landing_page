/**
 * 木陰 — Web アプリの入口
 *  - 画面（GitHub Pages 上の LIFF / 管理画面）からの API 呼び出し
 *  - LINE の Webhook（URL に ?webhook=<WEBHOOK_TOKEN> を付けて登録）
 */
function doGet() {
  return json_({ ok: true, service: 'kokage' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e.postData && e.postData.contents) || '{}');

    if (e.parameter && e.parameter.webhook !== undefined) {
      var token = prop('WEBHOOK_TOKEN');
      if (!token || e.parameter.webhook !== token) return json_({ ok: false });
      handleWebhook_(body);
      return json_({ ok: true });
    }

    return json_(handleApi_(body));
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: err.message || String(err), code: err.code || '' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleApi_(body) {
  var action = body.action;
  var auth = verifyIdToken_(body.idToken);
  var user = upsertUser_(auth.userId, auth.name);
  var ctx = { userId: auth.userId, name: auth.name || user.display_name, user: user };

  switch (action) {
    case 'init': return apiInit_(ctx);
    case 'apply': return withLock_(function () { return apiApply_(ctx, body); });
    case 'cancel': return withLock_(function () { return apiCancel_(ctx, body); });
    case 'request': return apiRequest_(ctx, body);
    case 'status': return apiStatus_(ctx);
  }

  if (!isAdmin(ctx.userId)) throw new Error('運営メンバーのみが使える機能です');
  switch (action) {
    case 'admin.overview': return apiAdminOverview_(ctx);
    case 'admin.generate': return { ok: true, copy: generateCopy_(body) };
    case 'admin.createEvent': return withLock_(function () { return apiAdminCreate_(ctx, body); });
  }
  throw new Error('不明な操作です: ' + action);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('混み合っています。少し待ってからもう一度お試しください。');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- 参加者向け ----------

function publicEvent_(ev, regs, userId) {
  var cfg = getConfig();
  var decision = decisionTimeOf(ev, cfg);
  var counts = countParticipants(ev.event_id, regs);
  var max = Number(ev.max_participants) || getConfig().DEFAULT_MAX_PARTICIPANTS;
  var mine = regs.filter(function (r) {
    return r.event_id === ev.event_id && r.line_user_id === userId && r.status === REG_STATUS.ACTIVE;
  })[0];
  return {
    id: ev.event_id,
    status: ev.status,
    date: ev.date,
    dateLabel: formatJpDate(ev.date),
    start: ev.start_time,
    end: ev.end_time,
    title: ev.title,
    description: ev.description,
    venue: ev.venue,
    host: ev.host_name,
    max: max,
    counts: counts,
    remaining: Math.max(0, max - counts.total),
    canApply: isOpenForApply(ev, new Date()),
    decisionLabel: decision ? formatJpDate(Utilities.formatDate(decision, 'Asia/Tokyo', 'yyyy-MM-dd')) + ' ' + Utilities.formatDate(decision, 'Asia/Tokyo', 'HH:mm') : '',
    mine: mine ? { fee: Number(mine.fee) || 0, type: mine.type, share: toBool(mine.share_declared) } : null
  };
}

function apiInit_(ctx) {
  var cfg = getConfig();
  var now = new Date();
  var events = table_('events').all();
  var regs = table_('registrations').all();
  var role = normalizeRole(ctx.user.role);
  var list = events
    .filter(function (ev) { return isOpenForApply(ev, now); })
    .sort(function (a, b) { return eventStart(a) - eventStart(b); })
    .map(function (ev) { return publicEvent_(ev, regs, ctx.userId); });

  return {
    ok: true,
    me: {
      name: ctx.name,
      role: role,
      roleLabel: ROLE_LABEL[role],
      isAdmin: isAdmin(ctx.userId),
      canSeeStatus: isAdmin(ctx.userId) || role === ROLE.MEMBER,
      firstTime: role === ROLE.GUEST ? isFirstTimeGuest(ctx.userId, regs, eventsById_(events), null) : false
    },
    fees: {
      venue: cfg.VENUE_FEE, first: cfg.GUEST_FIRST_FEE, regular: cfg.GUEST_REGULAR_FEE, discount: cfg.ACTION_DISCOUNT_AMOUNT
    },
    instagramUrl: cfg.INSTAGRAM_URL,
    events: list
  };
}

function apiApply_(ctx, body) {
  var cfg = getConfig();
  var now = new Date();
  if (!body.agreed) throw new Error('木陰のグランドルールへの同意が必要です');

  var evTable = table_('events');
  var events = evTable.all();
  var ev = events.filter(function (e) { return e.event_id === body.eventId; })[0];
  if (!ev) throw new Error('イベントが見つかりません');
  if (!isOpenForApply(ev, now)) throw new Error('この木陰はいまは申し込みを受け付けていません');

  var regTable = table_('registrations');
  var regs = regTable.all();
  var counts = countParticipants(ev.event_id, regs);
  var max = Number(ev.max_participants) || cfg.DEFAULT_MAX_PARTICIPANTS;
  var existing = regs.filter(function (r) { return r.event_id === ev.event_id && r.line_user_id === ctx.userId; });
  if (existing.some(function (r) { return r.status === REG_STATUS.ACTIVE; })) throw new Error('すでにお申し込み済みです');
  if (counts.total >= max) throw new Error('ごめんなさい、満席になりました');

  var role = normalizeRole(ctx.user.role);
  var type = regTypeForRole(role);
  var first = role === ROLE.GUEST ? isFirstTimeGuest(ctx.userId, regs, eventsById_(events), ev.event_id) : false;
  var share = role === ROLE.GUEST && !!body.shareDeclared;
  var fee = calcFee({ role: role, isFirstTime: first, shareDeclared: share }, cfg);

  var reg = {
    event_id: ev.event_id,
    event_title: ev.title,
    event_date: ev.date,
    line_user_id: ctx.userId,
    display_name: ctx.name,
    type: type,
    first_time: role === ROLE.GUEST ? boolLabel(first) : '',
    share_declared: boolLabel(share),
    referrer: String(body.referrer || '').slice(0, 100),
    agreed_rules: boolLabel(true),
    fee: fee.total,
    status: REG_STATUS.ACTIVE,
    created_at: nowStamp_(),
    cancelled_at: ''
  };
  var prev = existing[0];
  if (prev) {
    regTable.update(prev._row, reg);
    reg.reg_id = prev.reg_id;
  } else {
    reg.reg_id = newId_('R');
    regTable.append(reg);
  }

  // 開催決定後の追加申込は、運営3名とホストへお知らせ（会場予約の人数が変わるため）
  if (ev.status === EVENT_STATUS.GO) notifyChange_('apply', ev, ctx.name, regTable.all());

  return {
    ok: true,
    fee: fee,
    type: type,
    triggerText: buildTriggerText('apply', ev.event_id),
    instagramUrl: cfg.INSTAGRAM_URL
  };
}

function apiCancel_(ctx, body) {
  var now = new Date();
  var events = table_('events').all();
  var ev = events.filter(function (e) { return e.event_id === body.eventId; })[0];
  if (!ev) throw new Error('イベントが見つかりません');
  if (!isOpenForCancel(ev, now)) throw new Error('この木陰はキャンセルを受け付けられない状態です。公式LINEのチャットでご連絡ください。');

  var regTable = table_('registrations');
  var reg = regTable.all().filter(function (r) {
    return r.event_id === ev.event_id && r.line_user_id === ctx.userId && r.status === REG_STATUS.ACTIVE;
  })[0];
  if (!reg) throw new Error('お申し込みが見つかりません');
  regTable.update(reg._row, { status: REG_STATUS.CANCELLED, cancelled_at: nowStamp_() });

  // キャンセルした回が「初回」だった場合、次の申込を自動で初回料金に戻す
  var changes = recomputeFirstTime_([ctx.userId]);

  if (ev.status === EVENT_STATUS.GO) notifyChange_('cancel', ev, ctx.name, regTable.all());
  return {
    ok: true,
    triggerText: buildTriggerText('cancel', ev.event_id),
    feeChanges: changes.map(function (c) { return { title: c.event.title, dateLabel: formatJpDate(c.event.date), fee: c.fee }; })
  };
}

function apiRequest_(ctx, body) {
  var text = String(body.text || '').trim();
  if (!text) throw new Error('テーマを書いてください');
  table_('requests').append({
    created_at: nowStamp_(), line_user_id: ctx.userId, display_name: ctx.name, request_text: text.slice(0, 1000), memo: ''
  });
  return { ok: true };
}

// ---------- 運営向け ----------

var OWNER_HOST = '__owner__';

/** 開催決定後の追加申込・キャンセルを、運営3名とホスト（LQメンバーの場合）へ Push */
function notifyChange_(kind, ev, name, regs) {
  var counts = countParticipants(ev.event_id, regs);
  pushToAdmins_(buildAdminChangeMessage(kind, ev, name, counts, false),
    { kind: kind === 'cancel' ? '管理者:キャンセル' : '管理者:追加申込', eventId: ev.event_id });
  if (ev.host_user_id && !isAdmin(ev.host_user_id)) {
    push_(ev.host_user_id, buildAdminChangeMessage(kind, ev, name, counts, true),
      { kind: kind === 'cancel' ? 'ホスト:キャンセル' : 'ホスト:追加申込', eventId: ev.event_id, name: ev.host_name });
  }
}

/**
 * 申込状況
 *  - LQメンバー：「募集中」「開催決定」の回だけ。名前と参加区分のみ（料金・紹介者は見せない）
 *  - 運営：すべての回・すべての項目
 */
function apiStatus_(ctx) {
  var admin = isAdmin(ctx.userId);
  var role = normalizeRole(ctx.user.role);
  if (!admin && role !== ROLE.MEMBER) throw new Error('ライフクエストのメンバーと運営だけが見られます');
  var cfg = getConfig();
  var regs = table_('registrations').all();
  var list = table_('events').all()
    .filter(function (ev) { return admin || ev.status === EVENT_STATUS.OPEN || ev.status === EVENT_STATUS.GO; })
    .sort(function (a, b) { return (eventStart(a) || 0) - (eventStart(b) || 0); });
  if (admin) list = list.slice(-60);
  return {
    ok: true,
    admin: admin,
    minTotal: cfg.MIN_TOTAL_PARTICIPANTS,
    minGuest: cfg.MIN_GUEST_PARTICIPANTS,
    events: list.map(function (ev) {
      var base = publicEvent_(ev, regs, ctx.userId);
      base.isHost = ev.host_user_id === ctx.userId;
      base.registrations = regs.filter(function (r) {
        return r.event_id === ev.event_id && (admin || r.status === REG_STATUS.ACTIVE);
      }).map(function (r) {
        var o = { name: r.display_name, type: r.type, status: r.status };
        if (admin) {
          o.fee = Number(r.fee) || 0; o.first = toBool(r.first_time); o.share = toBool(r.share_declared); o.referrer = r.referrer;
        }
        return o;
      });
      return base;
    })
  };
}

function apiAdminOverview_(ctx) {
  var cfg = getConfig();
  var events = table_('events').all();
  var regs = table_('registrations').all();
  var users = table_('users').all();
  var hosts = users
    .filter(function (u) {
      if (isOwner(u.line_user_id)) return false;
      var r = normalizeRole(u.role);
      return r === ROLE.MEMBER || r === ROLE.IQ || isAdmin(u.line_user_id);
    })
    .map(function (u) {
      var r = normalizeRole(u.role);
      var label = r === ROLE.GUEST ? '運営' : ROLE_LABEL[r] + (isAdmin(u.line_user_id) ? '・運営' : '');
      return { id: u.line_user_id, name: u.display_name, role: label };
    });

  var list = events
    .sort(function (a, b) { return (eventStart(b) || 0) - (eventStart(a) || 0); })
    .slice(0, 60)
    .map(function (ev) {
      var base = publicEvent_(ev, regs, '');
      var decision = decisionTimeOf(ev, cfg);
      base.decisionLabel = decision ? Utilities.formatDate(decision, 'Asia/Tokyo', 'M/d HH:mm') : '';
      base.hostId = ev.host_user_id || (ev.host_name ? OWNER_HOST : '');
      base.caption = ev.caption;
      base.rawIdea = ev.raw_idea;
      base.sourceEventId = ev.source_event_id;
      base.link = entryLink(ev.event_id);
      base.registrations = regs
        .filter(function (r) { return r.event_id === ev.event_id; })
        .map(function (r) {
          return {
            name: r.display_name, type: r.type, fee: Number(r.fee) || 0, status: r.status,
            first: toBool(r.first_time), share: toBool(r.share_declared), referrer: r.referrer, at: r.created_at
          };
        });
      return base;
    });

  var requests = table_('requests').all().reverse().slice(0, 50).map(function (r) {
    return { at: r.created_at, name: r.display_name, text: r.request_text };
  });

  return {
    ok: true,
    me: { name: ctx.name },
    config: {
      minTotal: cfg.MIN_TOTAL_PARTICIPANTS, minGuest: cfg.MIN_GUEST_PARTICIPANTS,
      daysBefore: cfg.GO_NOGO_DAYS_BEFORE, hour: cfg.GO_NOGO_HOUR, duration: cfg.EVENT_DURATION_HOURS,
      venue: cfg.DEFAULT_VENUE, start: cfg.DEFAULT_START_TIME, max: cfg.DEFAULT_MAX_PARTICIPANTS,
      fees: { venue: cfg.VENUE_FEE, first: cfg.GUEST_FIRST_FEE, regular: cfg.GUEST_REGULAR_FEE, discount: cfg.ACTION_DISCOUNT_AMOUNT },
      instagramHandle: cfg.INSTAGRAM_HANDLE, entryLink: entryLink()
    },
    pushCount: pushCountThisMonth_(),
    pushLimit: cfg.PUSH_MONTHLY_LIMIT,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    hosts: hosts,
    ownerHost: OWNER_HOST,
    ownerName: cfg.OWNER_NAME,
    events: list,
    requests: requests
  };
}

function apiAdminCreate_(ctx, body) {
  var cfg = getConfig();
  var date = normalizeDate(body.date);
  var start = normalizeTime(body.start || cfg.DEFAULT_START_TIME);
  var title = String(body.title || '').trim();
  var description = String(body.description || '').trim();
  var venue = String(body.venue || cfg.DEFAULT_VENUE).trim();
  var max = Number(body.max) || cfg.DEFAULT_MAX_PARTICIPANTS;
  if (!date || !start) throw new Error('開催日と開始時間を入力してください');
  if (!title || !description) throw new Error('タイトルと案内文を入力してください');
  if (!venue) throw new Error('場所を入力してください');
  if (max < cfg.MIN_TOTAL_PARTICIPANTS) throw new Error('定員は最小催行人数（' + cfg.MIN_TOTAL_PARTICIPANTS + '名）以上にしてください');

  var ev = {
    event_id: newId_('E'),
    status: EVENT_STATUS.OPEN,
    date: date,
    start_time: start,
    end_time: addHoursToTime(start, cfg.EVENT_DURATION_HOURS),
    title: title,
    description: description,
    caption: String(body.caption || ''),
    raw_idea: String(body.idea || ''),
    venue: venue,
    max_participants: max,
    host_user_id: '',
    host_name: '',
    source_event_id: String(body.sourceEventId || ''),
    created_by: ctx.name,
    created_at: nowStamp_(),
    decided_at: '',
    thanks_sent_at: '',
    revenge_sent_at: ''
  };
  var decision = decisionTimeOf(ev, cfg);
  if (!decision || decision.getTime() <= Date.now()) {
    throw new Error('開催判定（' + cfg.GO_NOGO_DAYS_BEFORE + '日前の' + cfg.GO_NOGO_HOUR + '時）がすでに過ぎている日付です。もっと先の日付を選んでください。');
  }

  var host = null;
  if (body.hostId === OWNER_HOST || isOwner(body.hostId)) {
    // うってぃがホスト：参加費・場所代なし。参加者として登録しない（人数にも数えない）
    ev.host_name = cfg.OWNER_NAME;
  } else if (body.hostId) {
    // LQメンバー・IQ受講生・うってぃ以外の運営がホスト：場所代500円で参加者として登録
    host = findUser_(body.hostId);
    if (!host) throw new Error('ホストが名簿に見つかりません');
    ev.host_user_id = host.line_user_id;
    ev.host_name = host.display_name;
  } else {
    throw new Error('ホストを選んでください');
  }

  var evTable = table_('events');
  evTable.append(ev);

  if (host) {
    var role = normalizeRole(host.role);
    var fee = calcFee({ role: role === ROLE.GUEST ? ROLE.MEMBER : role, isFirstTime: false, shareDeclared: false }, cfg);
    table_('registrations').append({
      reg_id: newId_('R'), event_id: ev.event_id, event_title: ev.title, event_date: ev.date,
      line_user_id: host.line_user_id, display_name: host.display_name, type: REG_TYPE.HOST,
      first_time: '', share_declared: boolLabel(false), referrer: '', agreed_rules: boolLabel(true),
      fee: fee.total, status: REG_STATUS.ACTIVE, created_at: nowStamp_(), cancelled_at: ''
    });
  }

  // 別日で再企画：前回申し込んでくれた一般の方へ特別ご案内（Push）
  var invited = 0;
  if (ev.source_event_id) {
    var seen = {};
    table_('registrations').all().filter(function (r) {
      return r.event_id === ev.source_event_id && r.status === REG_STATUS.ACTIVE && isGuestType(r.type);
    }).forEach(function (r) {
      if (seen[r.line_user_id]) return;
      seen[r.line_user_id] = true;
      if (push_(r.line_user_id, buildRevengeMessage(r.display_name, ev, entryLink(ev.event_id)),
        { kind: '特別ご案内', eventId: ev.event_id, name: r.display_name })) invited++;
    });
    var rows = evTable.all().filter(function (e) { return e.event_id === ev.event_id; });
    if (rows[0]) evTable.update(rows[0]._row, { revenge_sent_at: nowStamp_() });
  }

  return { ok: true, eventId: ev.event_id, link: entryLink(ev.event_id), invited: invited };
}

/**
 * 一般参加者の「初回」料金を割り当て直す（中止・キャンセルで初回が空いたら次の申込を初回に戻す）。
 * 料金を変えるのは「募集中」の回だけ（開催決定のお知らせ後に金額が変わらないように）。
 * userIds を省略すると全員を見直す。戻り値：料金が変わった申込の一覧
 */
function recomputeFirstTime_(userIds) {
  var cfg = getConfig();
  var regTable = table_('registrations');
  var regs = regTable.all();
  var byId = eventsById_(table_('events').all());
  var targets = userIds || regs.filter(function (r) { return isGuestType(r.type); })
    .map(function (r) { return r.line_user_id; })
    .filter(function (id, i, arr) { return id && arr.indexOf(id) === i; });
  var changes = [];
  targets.forEach(function (userId) {
    var plan = firstTimeAssignments(userId, regs, byId);
    regs.forEach(function (r) {
      if (!(r.reg_id in plan)) return;
      var ev = byId[r.event_id];
      if (!ev || ev.status !== EVENT_STATUS.OPEN) return;
      var first = plan[r.reg_id];
      if (toBool(r.first_time) === first) return;
      var fee = calcFee({ role: ROLE.GUEST, isFirstTime: first, shareDeclared: toBool(r.share_declared) }, cfg).total;
      regTable.update(r._row, { first_time: boolLabel(first), fee: fee });
      r.first_time = boolLabel(first);
      r.fee = String(fee);
      changes.push({ userId: userId, reg: r, event: ev, fee: fee, first: first });
    });
  });
  return changes;
}
