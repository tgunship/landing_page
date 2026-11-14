/**
 * 木陰 — 初期設定（スプレッドシートのメニューから実行）
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('木陰')
    .addItem('① 初期設定（シートを作る）', 'setupSheets')
    .addItem('② 定期実行をオンにする', 'installTriggers')
    .addItem('設定チェック', 'checkSettings')
    .addSeparator()
    .addItem('今すぐ開催判定・終了処理を実行', 'cronTick')
    .addToUi();
}

function setupSheets() {
  var ss = getSpreadsheet_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  if (!prop('WEBHOOK_TOKEN')) {
    PropertiesService.getScriptProperties().setProperty('WEBHOOK_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  }

  Object.keys(TABLES).forEach(function (key) {
    var def = TABLES[key];
    var sheet = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    var headers = def.columns.map(function (c) { return c[1]; });
    var lastCol = sheet.getLastColumn();
    var existing = lastCol ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
    // 足りない見出しだけを右端に追加（既存の列・データには触れない）
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold').setBackground('#e3f1f1');

    // 日付・時刻・IDが勝手に変換されないよう、数値以外の列は「書式なしテキスト」に
    var t = new Table_(key);
    var idx = t.index();
    def.columns.forEach(function (c) {
      if (!NUMBER_COLUMNS[c[0]]) sheet.getRange(2, idx[c[0]], sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    });

    // プルダウン（手で書き換えるときの入力ミス防止）
    if (key === 'users') setDropdown_(sheet, idx.role, [ROLE_LABEL.guest, ROLE_LABEL.member, ROLE_LABEL.iq]);
    if (key === 'events') setDropdown_(sheet, idx.status, [EVENT_STATUS.OPEN, EVENT_STATUS.GO, EVENT_STATUS.CANCELLED, EVENT_STATUS.DONE]);
    if (key === 'registrations') {
      setDropdown_(sheet, idx.status, [REG_STATUS.ACTIVE, REG_STATUS.CANCELLED]);
      setDropdown_(sheet, idx.type, [REG_TYPE.HOST, REG_TYPE.MEMBER, REG_TYPE.IQ, REG_TYPE.GUEST]);
    }
  });

  var first = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  SpreadsheetApp.getUi().alert('シートの準備ができました。\n\n続けて「設定チェック」でスクリプト プロパティを確認してください。');
}

function setDropdown_(sheet, col, values) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cronTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronTick').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert('定期実行（15分ごと）をオンにしました。');
}

function checkSettings() {
  var required = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_LOGIN_CHANNEL_ID', 'LIFF_ID', 'ADMIN_LINE_USER_IDS', 'OWNER_LINE_USER_ID', 'GEMINI_API_KEY', 'WEBHOOK_TOKEN'];
  var lines = required.map(function (k) { return (prop(k) ? '✅ ' : '❌ ') + k; });
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* noop */ }
  lines.push('');
  lines.push('運営（管理者通知の宛先）: ' + adminIds().length + '名');
  lines.push('DRY_RUN（LINEを実際には送らないテストモード）: ' + (isDryRun() ? 'オン' : 'オフ'));
  lines.push('');
  lines.push('WebアプリURL: ' + (url || '（まだデプロイされていません）'));
  if (url) lines.push('LINEのWebhook URL:\n' + url + '?webhook=' + prop('WEBHOOK_TOKEN'));
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'cronTick'; });
  lines.push('');
  lines.push('定期実行: ' + (hasTrigger ? 'オン' : 'オフ（②を実行してください）'));
  console.log(lines.join('\n'));
  SpreadsheetApp.getUi().alert(lines.join('\n'));
}
