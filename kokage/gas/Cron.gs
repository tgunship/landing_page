/**
 * 木陰 — 定期実行（15分ごと）
 *  1. 人数のお知らせ：開催3日前の12時に、運営へ人数を Push（会場の予約・人数確認用。中止の判定はしない）
 *  2. お礼：本編2時間が終わったら、一般の参加者へ「感想の投稿のお願い」を Push
 *  3. 終了：終了時刻を過ぎた回を「終了」に
 *  4. 料金の見直し：スプレッドシートで手でキャンセルにした場合も、初回料金・割り勘を整える
 *
 * Google のサーバーで動くタイマー（トリガー）なので、スリープで止まる心配はありません。
 */
function cronTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var now = new Date();
    refreshFees_();
    runNotice_(now);
    runThanks_(now);
    runFinish_(now);
  } finally {
    lock.releaseLock();
  }
}

function runNotice_(now) {
  var cfg = getConfig();
  var evTable = table_('events');
  var regs = null;
  evTable.all().forEach(function (ev) {
    if (!shouldNoticeNow(ev, now, cfg)) return;
    regs = regs || table_('registrations').all();
    var counts = countParticipants(ev.event_id, regs);
    evTable.update(ev._row, { decided_at: nowStamp_() });
    pushToAdmins_(buildAdminNoticeMessage(ev, counts, venueShare(ev, counts.total, cfg)),
      { kind: '管理者:人数のお知らせ', eventId: ev.event_id });
  });
}

function runThanks_(now) {
  var cfg = getConfig();
  var evTable = table_('events');
  var regs = null;
  evTable.all().forEach(function (ev) {
    if (!shouldThankNow(ev, now, cfg)) return;
    regs = regs || table_('registrations').all();
    regs.filter(function (r) {
      return r.event_id === ev.event_id && r.status === REG_STATUS.ACTIVE && isGuestType(r.type);
    }).forEach(function (r) {
      push_(r.line_user_id, buildThanksMessage(r.display_name, ev, cfg, toBool(r.share_declared)),
        { kind: 'お礼', eventId: ev.event_id, name: r.display_name });
    });
    evTable.update(ev._row, { thanks_sent_at: nowStamp_() });
  });
}

function runFinish_(now) {
  var evTable = table_('events');
  evTable.all().forEach(function (ev) {
    if (shouldFinishNow(ev, now)) evTable.update(ev._row, { status: EVENT_STATUS.DONE });
  });
}
