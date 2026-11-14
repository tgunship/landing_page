/**
 * 木陰 — LINE 連携
 *  - LIFF の IDトークン検証（誰が操作しているかを安全に確認）
 *  - Reply API（無料：利用者の操作への返信）
 *  - Push API（通数カウント対象：開催判定・お礼・特別ご案内・管理者通知）
 *  - Webhook（友だち追加・トリガーメッセージ）
 */

var LINE_API = 'https://api.line.me';

/** LIFF の IDトークンを LINE に問い合わせて検証し、{userId, name} を返す */
function verifyIdToken_(idToken) {
  if (!idToken) throw new AuthError_('ログインが必要です');
  var channelId = prop('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw new Error('スクリプト プロパティ LINE_LOGIN_CHANNEL_ID が未設定です');
  var res = UrlFetchApp.fetch(LINE_API + '/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !body.sub) {
    throw new AuthError_('ログインの有効期限が切れました（' + (body.error_description || res.getResponseCode()) + '）');
  }
  return { userId: body.sub, name: body.name || '' };
}

function AuthError_(message) {
  this.name = 'AuthError';
  this.message = message;
  this.code = 'AUTH';
}
AuthError_.prototype = Object.create(Error.prototype);

function lineFetch_(path, payload, method) {
  var token = prop('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('スクリプト プロパティ LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  var opts = {
    method: method || 'post',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (payload) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  return UrlFetchApp.fetch(LINE_API + path, opts);
}

function textMessages_(text) {
  // LINE のテキストは1通5000文字まで
  return [{ type: 'text', text: String(text).slice(0, 4900) }];
}

/** Reply API（無料・通数にカウントされない） */
function reply_(replyToken, text) {
  if (!replyToken) return;
  if (isDryRun()) { console.log('[DRY_RUN reply] ' + text); return; }
  var res = lineFetch_('/v2/bot/message/reply', { replyToken: replyToken, messages: textMessages_(text) });
  if (res.getResponseCode() !== 200) console.warn('reply failed: ' + res.getContentText());
}

/**
 * Push API（通数カウント対象）。
 * ブロックされている等で失敗しても例外を投げず、送信ログに残して次へ進む。
 */
function push_(to, text, meta) {
  meta = meta || {};
  var result;
  if (isDryRun()) {
    console.log('[DRY_RUN push to ' + to + '] ' + text);
    result = 'DRY_RUN';
  } else {
    try {
      var res = lineFetch_('/v2/bot/message/push', { to: to, messages: textMessages_(text) });
      result = res.getResponseCode() === 200 ? 'OK' : 'NG ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200);
    } catch (err) {
      result = 'NG ' + err.message;
    }
  }
  try {
    table_('pushlog').append({
      sent_at: nowStamp_(), to: to, display_name: meta.name || '', kind: meta.kind || '',
      event_id: meta.eventId || '', result: result
    });
  } catch (err) {
    console.warn('push log failed: ' + err.message);
  }
  return result === 'OK' || result === 'DRY_RUN';
}

function pushToAdmins_(text, meta) {
  adminIds().forEach(function (id) {
    push_(id, text, { kind: (meta && meta.kind) || '管理者通知', eventId: meta && meta.eventId, name: '運営' });
  });
}

/** 今月の Push 送信数（送信ログから） */
function pushCountThisMonth_() {
  var ym = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
  return table_('pushlog').all().filter(function (r) {
    return r.sent_at.indexOf(ym) === 0 && r.result === 'OK';
  }).length;
}

function fetchProfileName_(userId) {
  try {
    var res = lineFetch_('/v2/bot/profile/' + encodeURIComponent(userId), null, 'get');
    if (res.getResponseCode() === 200) return JSON.parse(res.getContentText()).displayName || '';
  } catch (err) { /* noop */ }
  return '';
}

// ---------- Webhook ----------

function handleWebhook_(body) {
  var events = body.events || [];
  events.forEach(function (ev) {
    try {
      handleWebhookEvent_(ev);
    } catch (err) {
      console.error('webhook event error: ' + (err && err.stack || err));
    }
  });
}

function handleWebhookEvent_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId || (ev.source.type && ev.source.type !== 'user')) return;

  if (ev.type === 'follow') {
    var u = findUser_(userId);
    var name = (u && u.display_name) || fetchProfileName_(userId);
    upsertUser_(userId, name);
    reply_(ev.replyToken, [
      (name ? name + 'さん、' : '') + '友だち追加ありがとうございます🌿',
      '',
      '「木陰」は、慌ただしい日常から、ふうっと一息つける場所です。',
      '下のメニューから、募集中の木陰を見たり、申し込んだりできます。',
      '',
      entryLink()
    ].join('\n'));
    return;
  }

  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') {
    if (ev.type === 'message' && !findUser_(userId)) upsertUser_(userId, fetchProfileName_(userId));
    return;
  }

  var text = String(ev.message.text || '').trim();
  var user = findUser_(userId) || upsertUser_(userId, fetchProfileName_(userId));

  // 運営・メンバー登録用：自分の LINE ユーザーID を確認する合言葉
  if (/^(id|ID|ＩＤ|ユーザーID|ユーザーＩＤ)$/.test(text)) {
    reply_(ev.replyToken, 'あなたのLINEユーザーIDはこちらです。\n' + userId);
    return;
  }

  var trig = parseTriggerMessage(text);
  if (!trig) return; // それ以外のメッセージは自動返信しない（運営が手動で返信できるように）

  var cfg = getConfig();
  var events = table_('events').all();
  var target = null;
  for (var i = 0; i < events.length; i++) if (events[i].event_id === trig.eventId) target = events[i];
  if (!target) return;

  var regs = table_('registrations').all().filter(function (r) {
    return r.event_id === trig.eventId && r.line_user_id === userId;
  });
  var name = (user && user.display_name) || '';
  if (trig.kind === 'apply') {
    var reg = regs.filter(function (r) { return r.status === REG_STATUS.ACTIVE; })[0];
    if (reg) reply_(ev.replyToken, buildApplyReply(name, target, reg, cfg));
  } else {
    var c = regs.filter(function (r) { return r.status === REG_STATUS.CANCELLED; })[0];
    if (!c) return;
    var now = new Date();
    var byId = eventsById_(events);
    var others = table_('registrations').all().filter(function (r) {
      return r.line_user_id === userId && r.status === REG_STATUS.ACTIVE && byId[r.event_id] && isOpenForCancel(byId[r.event_id], now);
    }).map(function (r) { return { event: byId[r.event_id], reg: r }; });
    reply_(ev.replyToken, buildCancelReply(name, target, others));
  }
}
