/**
 * 木陰 — 定期実行（15分ごと）
 *  1. 開催判定（開催3日前の12時を過ぎた「募集中」のイベント）
 *  2. 終了処理（終了時刻を過ぎた「開催決定」のイベント → お礼LINE → 「終了」に）
 *
 * Google のサーバーで動くタイマー（トリガー）なので、スリープで止まる心配はありません。
 * メニュー「木陰 → 定期実行をオンにする」で設定されます。
 */
function cronTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var now = new Date();
    runGoNoGo_(now);
    runFinish_(now);
  } finally {
    lock.releaseLock();
  }
}

function runGoNoGo_(now) {
  var cfg = getConfig();
  var evTable = table_('events');
  var events = evTable.all();
  var regs = null;
  var users = null;

  events.forEach(function (ev) {
    if (!shouldDecideNow(ev, now, cfg)) return;
    regs = regs || table_('registrations').all();
    users = users || table_('users').all();
    var counts = countParticipants(ev.event_id, regs);
    var go = isGo(counts, cfg);
    evTable.update(ev._row, { status: go ? EVENT_STATUS.GO : EVENT_STATUS.CANCELLED, decided_at: nowStamp_() });
    ev.status = go ? EVENT_STATUS.GO : EVENT_STATUS.CANCELLED;

    regs.filter(function (r) { return r.event_id === ev.event_id && r.status === REG_STATUS.ACTIVE; })
      .forEach(function (r) {
        var name = r.display_name || nameOf_(users, r.line_user_id);
        var text = go ? buildGoMessage(name, ev, r, cfg) : buildNoGoMessage(name, ev);
        push_(r.line_user_id, text, { kind: go ? '開催決定' : '開催見送り', eventId: ev.event_id, name: name });
      });

    pushToAdmins_(go ? buildAdminGoMessage(ev, counts) : buildAdminNoGoMessage(ev, counts),
      { kind: go ? '管理者:開催決定' : '管理者:中止', eventId: ev.event_id });
  });
}

function runFinish_(now) {
  var cfg = getConfig();
  var evTable = table_('events');
  var regs = null;
  evTable.all().forEach(function (ev) {
    if (!shouldFinishNow(ev, now)) return;
    regs = regs || table_('registrations').all();
    if (!ev.thanks_sent_at) {
      regs.filter(function (r) {
        return r.event_id === ev.event_id && r.status === REG_STATUS.ACTIVE && isGuestType(r.type) && toBool(r.share_declared);
      }).forEach(function (r) {
        push_(r.line_user_id, buildThanksMessage(r.display_name, ev, cfg), { kind: 'お礼', eventId: ev.event_id, name: r.display_name });
      });
    }
    evTable.update(ev._row, { status: EVENT_STATUS.DONE, thanks_sent_at: ev.thanks_sent_at || nowStamp_() });
  });
}

function nameOf_(users, userId) {
  for (var i = 0; i < users.length; i++) if (users[i].line_user_id === userId) return users[i].display_name;
  return '';
}
