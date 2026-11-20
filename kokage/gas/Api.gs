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
    case 'triggerFailed': return apiTriggerFailed_(ctx, body);
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
  var counts = countParticipants(ev.event_id, regs);
  var max = Number(ev.max_participants) || cfg.DEFAULT_MAX_PARTICIPANTS;
  var mine = regs.filter(function (r) {
    return r.event_id === ev.event_id && r.line_user_id === userId && r.status === REG_STATUS.ACTIVE;
  })[0];
  var f = findFormat(ev.format);
  return {
    id: ev.event_id,
    status: ev.status,
    date: ev.date,
    dateLabel: formatJpDate(ev.date),
    start: ev.start_time,
    end: ev.end_time,
    title: ev.title,
    description: ev.description,
    format: (f || {}).key || 'other',
    formatLabel: (f || {}).label || '',
    series: seriesName(ev),
    kicker: (f || {}).kicker || '',
    workTitle: ev.work_title,
    workLine: workLine(ev),
    venue: ev.venue,
    venueSplit: isSplitVenue(ev),
    venueFeeTotal: Number(ev.venue_fee_total) || 0,
    venueFeeCap: Number(ev.venue_fee_cap) || 0,
    venueShareNow: venueShare(ev, counts.total, cfg),
    hostVenueFeeNow: hostVenueFee(ev, counts.total, cfg),
    // 新しく申し込んだ場合の1人あたり場所代（割り勘なら人数が1人増えた計算）
    venueShareIfJoin: venueShare(ev, counts.total + (mine ? 0 : 1), cfg),
    host: ev.host_name,
    max: max,
    counts: counts,
    remaining: Math.max(0, max - counts.total),
    canApply: isOpenForApply(ev, new Date()),
    mine: mine ? { fee: Number(mine.fee) || 0, type: mine.type, share: toBool(mine.share_declared) } : null
  };
}

/** 申込状況タブを見られるか：運営・IQ受講生・募集中の回のホスト */
function canSeeStatus_(ctx, events) {
  if (isAdmin(ctx.userId) || normalizeRole(ctx.user.role) === ROLE.IQ) return true;
  return events.some(function (ev) { return ev.status === EVENT_STATUS.OPEN && ev.host_user_id === ctx.userId; });
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
      canSeeStatus: canSeeStatus_(ctx, events),
      firstTime: role === ROLE.GUEST ? isFirstTimeGuest(ctx.userId, regs, eventsById_(events), null) : false
    },
    fees: {
      venue: cfg.VENUE_FEE, first: cfg.GUEST_FIRST_FEE, regular: cfg.GUEST_REGULAR_FEE, discount: cfg.ACTION_DISCOUNT_AMOUNT
    },
    rules: GROUND_RULES,
    instagramUrl: cfg.INSTAGRAM_URL,
    events: list
  };
}

function apiApply_(ctx, body) {
  var cfg = getConfig();
  var now = new Date();
  if (isAdmin(ctx.userId)) throw new Error('運営の方は申し込み不要です（人数に数えません）');
  if (!body.agreed) throw new Error('木陰のグランドルールへの同意が必要です');

  var events = table_('events').all();
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
  var p = participationFee({ role: role, isFirstTime: first, shareDeclared: share }, cfg);
  var venueFee = venueShare(ev, counts.total + 1, cfg);

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
    fee: p.fee + venueFee,
    venue_fee: venueFee,
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

  // 別会場の割り勘は人数で変わるので、同じ回のほかの人（ホストの負担を含む）の金額も整える
  if (isSplitVenue(ev)) refreshFees_();

  var after = countParticipants(ev.event_id, table_('registrations').all());
  if (ev.decided_at) notifyHost_('apply', ev, ctx.name, after);

  return {
    ok: true,
    fee: { total: p.fee + venueFee, participation: p.fee, venue: venueFee, split: isSplitVenue(ev) },
    type: type,
    triggerText: buildTriggerText('apply', ev.event_id, ev),
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

  // キャンセルした回が「初回」だった場合は次の申込を初回料金に戻す。割り勘の金額も整える
  var changes = refreshFees_().filter(function (c) { return c.userId === ctx.userId && c.becameFirst; });

  var after = countParticipants(ev.event_id, table_('registrations').all());
  if (ev.decided_at) notifyHost_('cancel', ev, ctx.name, after);
  return {
    ok: true,
    triggerText: buildTriggerText('cancel', ev.event_id, ev),
    feeChanges: changes.map(function (c) { return { title: c.event.title, dateLabel: formatJpDate(c.event.date), fee: c.fee }; })
  };
}

/**
 * LINEアプリの外（パソコンのブラウザ等）で申し込んだため、合図のメッセージを公式LINEへ送れなかったとき。
 * 人数のお知らせ後の回だけは会場予約に関わるので、運営へ Push で知らせる（めったに起きない）。
 */
function apiTriggerFailed_(ctx, body) {
  var ev = table_('events').all().filter(function (e) { return e.event_id === body.eventId; })[0];
  if (!ev || !ev.decided_at || ev.status !== EVENT_STATUS.OPEN) return { ok: true, notified: false };
  var kind = body.kind === 'cancel' ? 'cancel' : 'apply';
  var regs = table_('registrations').all();
  var mine = regs.filter(function (r) {
    return r.event_id === ev.event_id && r.line_user_id === ctx.userId &&
      r.status === (kind === 'cancel' ? REG_STATUS.CANCELLED : REG_STATUS.ACTIVE);
  })[0];
  if (!mine) return { ok: true, notified: false };
  pushToAdmins_(buildChangeMessage(kind, ev, ctx.name, countParticipants(ev.event_id, regs), false),
    { kind: kind === 'cancel' ? '管理者:キャンセル' : '管理者:申込', eventId: ev.event_id });
  return { ok: true, notified: true };
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

/** 名簿上の呼び名（あれば）→ LINEの表示名 */
function callName_(u) {
  return (u && (u.nickname || u.display_name)) || '';
}

/**
 * 人数のお知らせ後の申込・キャンセルを、ホスト（運営以外の場合）へ Push。
 * 運営へは Push しない：参加者のトークから公式LINEへ届く合図のメッセージを受信箱で確認する（無料）。
 */
function notifyHost_(kind, ev, name, counts) {
  if (ev.host_user_id && !isAdmin(ev.host_user_id)) {
    push_(ev.host_user_id, buildChangeMessage(kind, ev, name, counts, true),
      { kind: kind === 'cancel' ? 'ホスト:キャンセル' : 'ホスト:申込', eventId: ev.event_id, name: ev.host_name });
  }
}

/**
 * 申込状況
 *  - 運営：すべての回・すべての項目
 *  - IQ受講生：「募集中」の回。名前と参加区分のみ（料金・紹介者は見せない）
 *  - 一般のホスト：自分がホストの「募集中」の回だけ。名前と参加区分のみ
 */
function apiStatus_(ctx) {
  var admin = isAdmin(ctx.userId);
  var iq = normalizeRole(ctx.user.role) === ROLE.IQ;
  var events = table_('events').all();
  if (!canSeeStatus_(ctx, events)) throw new Error('IQ受講生・ホスト・運営だけが見られます');
  var regs = table_('registrations').all();
  var list = events
    .filter(function (ev) {
      if (admin) return true;
      if (ev.status !== EVENT_STATUS.OPEN) return false;
      return iq || ev.host_user_id === ctx.userId;
    })
    .sort(function (a, b) { return (eventStart(a) || 0) - (eventStart(b) || 0); });
  if (admin) list = list.slice(-60);
  return {
    ok: true,
    admin: admin,
    events: list.map(function (ev) {
      var base = publicEvent_(ev, regs, ctx.userId);
      base.isHost = ev.host_user_id === ctx.userId;
      base.registrations = regs.filter(function (r) {
        return r.event_id === ev.event_id && (admin || r.status === REG_STATUS.ACTIVE);
      }).map(function (r) {
        var o = { name: r.display_name, type: r.type, status: r.status, isHost: r.line_user_id === ev.host_user_id };
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
  // ホスト候補：運営（費用なし・数えない）→ IQ受講生 → 一般
  var staff = users.filter(function (u) { return isAdmin(u.line_user_id); })
    .sort(function (a, b) { return (b.line_user_id === ctx.userId) - (a.line_user_id === ctx.userId); })
    .map(function (u) { return { id: u.line_user_id, name: callName_(u), role: '運営', staff: true }; });
  var others = users.filter(function (u) { return u.line_user_id && !isAdmin(u.line_user_id); })
    .map(function (u) { return { id: u.line_user_id, name: callName_(u), role: ROLE_LABEL[normalizeRole(u.role)], staff: false }; })
    .sort(function (a, b) { return (a.role === ROLE_LABEL.iq ? 0 : 1) - (b.role === ROLE_LABEL.iq ? 0 : 1); });
  var hosts = staff.concat(others);

  var list = events
    .sort(function (a, b) { return (eventStart(b) || 0) - (eventStart(a) || 0); })
    .slice(0, 60)
    .map(function (ev) {
      var base = publicEvent_(ev, regs, '');
      var notice = noticeTimeOf(ev, cfg);
      base.noticeLabel = notice ? Utilities.formatDate(notice, 'Asia/Tokyo', 'M/d HH:mm') : '';
      base.noticeSent = !!ev.decided_at;
      base.hostId = ev.host_user_id;
      base.caption = ev.caption;
      base.rawIdea = ev.raw_idea;
      base.link = entryLink(ev.event_id);
      base.registrations = regs
        .filter(function (r) { return r.event_id === ev.event_id; })
        .map(function (r) {
          return {
            name: r.display_name, type: r.type, fee: Number(r.fee) || 0, status: r.status, isHost: r.line_user_id === ev.host_user_id,
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
    me: { name: ctx.name, id: ctx.userId },
    config: {
      noticeDays: cfg.NOTICE_DAYS_BEFORE, noticeHour: cfg.NOTICE_HOUR,
      core: cfg.CORE_HOURS, duration: cfg.EVENT_DURATION_HOURS,
      venue: cfg.DEFAULT_VENUE, start: cfg.DEFAULT_START_TIME, max: cfg.DEFAULT_MAX_PARTICIPANTS,
      fees: { venue: cfg.VENUE_FEE, first: cfg.GUEST_FIRST_FEE, regular: cfg.GUEST_REGULAR_FEE, discount: cfg.ACTION_DISCOUNT_AMOUNT },
      instagramHandle: cfg.INSTAGRAM_HANDLE, entryLink: entryLink()
    },
    pushCount: pushCountThisMonth_(),
    pushLimit: cfg.PUSH_MONTHLY_LIMIT,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    hosts: hosts,
    formats: FORMATS.map(function (f) { return { key: f.key, label: f.label, work: f.work, series: f.series, kicker: f.kicker }; }),
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
  var fmt = findFormat(body.format);
  if (!fmt) throw new Error('型を選んでください');
  if (fmt.work && fmt.work.required && !String(body.workTitle || '').trim()) throw new Error(fmt.work.label + 'を入力してください');
  if (max < 1) throw new Error('定員は1名以上にしてください');

  // 別会場の場合は、場所代の合計を運営以外の参加者で割り勘（1人あたりの上限つき。足りない分はホストが負担）
  var venueFeeTotal = '';
  var venueFeeCap = '';
  if (venue !== cfg.DEFAULT_VENUE) {
    var t = String(body.venueFeeTotal == null ? '' : body.venueFeeTotal).trim();
    if (t === '' || isNaN(Number(t)) || Number(t) < 0) throw new Error('別会場の場所代（合計）を入力してください（無料なら0）');
    venueFeeTotal = Math.round(Number(t));
    if (venueFeeTotal > 0) {
      var c = String(body.venueFeeCap == null ? '' : body.venueFeeCap).trim();
      if (c === '' || isNaN(Number(c)) || Number(c) <= 0) throw new Error('場所代の上限（1人あたり）を入力してください');
      venueFeeCap = Math.round(Number(c));
    }
  }

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
    format: fmt.label,
    work_title: String(body.workTitle || '').trim(),
    venue: venue,
    venue_fee_total: venueFeeTotal,
    venue_fee_cap: venueFeeCap,
    max_participants: max,
    host_user_id: '',
    host_name: '',
    created_by: ctx.name,
    created_at: nowStamp_(),
    decided_at: '',
    thanks_sent_at: ''
  };
  var startAt = eventStart(ev);
  if (!startAt || startAt.getTime() <= Date.now()) throw new Error('開始時刻が過ぎています。これからの日時を選んでください。');

  if (!body.hostId) throw new Error('ホストを選んでください');
  var hostUser = findUser_(body.hostId);
  if (!hostUser) throw new Error('ホストが名簿に見つかりません');
  ev.host_user_id = hostUser.line_user_id;
  ev.host_name = callName_(hostUser);

  table_('events').append(ev);

  // 運営（うってぃ・ぎっしー）がホスト：費用なし・申込シートに登録しない・人数に数えない
  // それ以外がホスト：区分どおりの料金（IQ受講生は場所代のみ、一般の方は一般の初回／2回目以降）で参加者として登録
  if (!isAdmin(hostUser.line_user_id)) {
    var role = normalizeRole(hostUser.role);
    var regs = table_('registrations').all();
    var first = role === ROLE.GUEST ? isFirstTimeGuest(hostUser.line_user_id, regs, eventsById_(table_('events').all()), ev.event_id) : false;
    var p = participationFee({ role: role, isFirstTime: first, shareDeclared: false }, cfg);
    var venueFee = hostVenueFee(ev, 1, cfg);
    table_('registrations').append({
      reg_id: newId_('R'), event_id: ev.event_id, event_title: ev.title, event_date: ev.date,
      line_user_id: hostUser.line_user_id, display_name: callName_(hostUser), type: regTypeForRole(role),
      first_time: role === ROLE.GUEST ? boolLabel(first) : '', share_declared: boolLabel(false), referrer: '', agreed_rules: boolLabel(true),
      fee: p.fee + venueFee, venue_fee: venueFee, status: REG_STATUS.ACTIVE, created_at: nowStamp_(), cancelled_at: ''
    });
  }

  return { ok: true, eventId: ev.event_id, link: entryLink(ev.event_id) };
}

/**
 * 「募集中」の回の料金を整える。
 *  - 一般の「初回」：有効な申込のうち最初の1件だけ（キャンセルで空いたら次の申込が初回に戻る）
 *  - 別会場の場所代：いまの人数で割り勘（上限つき。足りない分・端数はホスト）
 * 変わった行だけ書き換える（手で直した金額は、初回・場所代が変わらない限りそのまま）。
 * 戻り値：変わった申込の一覧（becameFirst=初回料金に戻ったもの）
 */
function refreshFees_() {
  var cfg = getConfig();
  var regTable = table_('registrations');
  var regs = regTable.all();
  var byId = eventsById_(table_('events').all());
  var plans = {};
  var counts = {};
  var changes = [];
  regs.forEach(function (r) {
    if (r.status !== REG_STATUS.ACTIVE) return;
    var ev = byId[r.event_id];
    if (!ev || ev.status !== EVENT_STATUS.OPEN) return;
    var patch = {};
    var becameFirst = false;
    if (isGuestType(r.type)) {
      plans[r.line_user_id] = plans[r.line_user_id] || firstTimeAssignments(r.line_user_id, regs, byId);
      var first = !!plans[r.line_user_id][r.reg_id];
      if (toBool(r.first_time) !== first) {
        patch.first_time = boolLabel(first);
        r.first_time = patch.first_time;
        becameFirst = first;
      }
    }
    if (!(r.event_id in counts)) counts[r.event_id] = countParticipants(r.event_id, regs).total;
    var share = venueFeeFor(ev, counts[r.event_id], r.line_user_id === ev.host_user_id, cfg);
    if (String(r.venue_fee) === '' || Number(r.venue_fee) !== share) patch.venue_fee = share;
    if (!Object.keys(patch).length) return;
    var fee = participationFeeOfReg(r, cfg) + share;
    patch.fee = fee;
    regTable.update(r._row, patch);
    r.fee = String(fee);
    r.venue_fee = String(share);
    changes.push({ userId: r.line_user_id, reg: r, event: ev, fee: fee, becameFirst: becameFirst });
  });
  return changes;
}
