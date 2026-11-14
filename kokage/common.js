// 木陰 — 画面共通の処理（LIFF ログイン・API 呼び出し・表示用ヘルパー）
(function () {
  const C = window.KOKAGE_CONFIG;

  async function initLiff() {
    if (!C.LIFF_ID || C.LIFF_ID.indexOf('YOUR_') === 0) {
      throw new Error('config.js の LIFF_ID が未設定です');
    }
    await liff.init({ liffId: C.LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return false;
    }
    return true;
  }

  async function api(action, payload) {
    const body = Object.assign({ action, idToken: liff.getIDToken() }, payload || {});
    let res;
    try {
      res = await fetch(C.API_URL, {
        method: 'POST',
        // text/plain にすると Apps Script への呼び出しで事前確認（CORS preflight）が発生しない
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('通信できませんでした。電波の良いところでもう一度お試しください。');
    }
    const data = await res.json();
    if (!data.ok) {
      if (data.code === 'AUTH') {
        // ログインの有効期限切れ → 取り直す
        if (liff.isInClient()) { location.reload(); } else { liff.logout(); liff.login({ redirectUri: location.href }); }
      }
      throw new Error(data.error || 'エラーが発生しました');
    }
    return data;
  }

  /** 利用者のトークから合図のメッセージを送る（→ 無料の Reply API で返信が届く） */
  async function sendTrigger(text) {
    if (!text || !liff.isInClient()) return false;
    try {
      await liff.sendMessages([{ type: 'text', text }]);
      return true;
    } catch (e) {
      console.warn('sendMessages failed', e);
      return false;
    }
  }

  const yen = (n) => Number(n || 0).toLocaleString('ja-JP') + '円';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function toast(msg, isError) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, isError ? 6000 : 3000);
  }

  window.Kokage = { initLiff, api, sendTrigger, yen, esc, $, $$, toast, config: C };
})();
