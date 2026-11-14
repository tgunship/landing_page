/**
 * 木陰 — スプレッドシートを「データベース」として読み書きする部分
 *
 * 列は「1行目の見出しの文字」で探します。
 *   ・列の順番を入れ替えても、行を追加・削除しても、セルを書き換えても動きます。
 *   ・見出し（1行目）の文字を変える／見出しの列を消す／タブ名を変える と動かなくなります。
 */
var TABLES = {
  users: {
    name: '名簿',
    columns: [
      ['line_user_id', 'LINEユーザーID'],
      ['display_name', '表示名'],
      ['role', '区分'],
      ['memo', 'メモ'],
      ['created_at', '登録日時'],
      ['updated_at', '更新日時']
    ]
  },
  events: {
    name: 'イベント',
    columns: [
      ['event_id', 'イベントID'],
      ['status', '状態'],
      ['date', '開催日'],
      ['start_time', '開始'],
      ['end_time', '終了'],
      ['title', 'タイトル'],
      ['description', '案内文'],
      ['caption', 'インスタ投稿文'],
      ['raw_idea', '企画の想い（元の文章）'],
      ['venue', '場所'],
      ['max_participants', '定員'],
      ['host_user_id', 'ホストのLINEユーザーID'],
      ['host_name', 'ホスト'],
      ['source_event_id', '再企画元イベントID'],
      ['created_by', '作成者'],
      ['created_at', '作成日時'],
      ['decided_at', '開催判定日時'],
      ['thanks_sent_at', 'お礼送信日時'],
      ['revenge_sent_at', '特別ご案内送信日時']
    ]
  },
  registrations: {
    name: '申込',
    columns: [
      ['reg_id', '申込ID'],
      ['event_id', 'イベントID'],
      ['event_title', 'イベント'],
      ['event_date', '開催日'],
      ['line_user_id', 'LINEユーザーID'],
      ['display_name', '表示名'],
      ['type', '参加区分'],
      ['first_time', '初回'],
      ['share_declared', '発信・口コミ割引'],
      ['referrer', '紹介者'],
      ['agreed_rules', 'ルール同意'],
      ['fee', '当日お支払い'],
      ['status', '状態'],
      ['created_at', '申込日時'],
      ['cancelled_at', 'キャンセル日時']
    ]
  },
  requests: {
    name: 'テーマのお便り',
    columns: [
      ['created_at', '受付日時'],
      ['line_user_id', 'LINEユーザーID'],
      ['display_name', '表示名'],
      ['request_text', 'やってほしいテーマ'],
      ['memo', 'メモ']
    ]
  },
  pushlog: {
    name: '送信ログ',
    columns: [
      ['sent_at', '送信日時'],
      ['to', '宛先LINEユーザーID'],
      ['display_name', '宛先'],
      ['kind', '種類'],
      ['event_id', 'イベントID'],
      ['result', '結果']
    ]
  }
};

// 文字列のまま保存したい列（日付や時刻が勝手に変換されないように）
var NUMBER_COLUMNS = { fee: true, max_participants: true };

function getSpreadsheet_() {
  var id = prop('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function Table_(key) {
  var def = TABLES[key];
  var sheet = getSpreadsheet_().getSheetByName(def.name);
  if (!sheet) throw new Error('シート「' + def.name + '」が見つかりません。メニュー「木陰 → 初期設定」を実行してください。');
  this.def = def;
  this.sheet = sheet;
  this._index = null;
}

/** 見出しの文字 → 列番号（1始まり） */
Table_.prototype.index = function () {
  if (this._index) return this._index;
  var lastCol = this.sheet.getLastColumn();
  var header = lastCol ? this.sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  var pos = {};
  header.forEach(function (h, i) { pos[String(h).trim()] = i + 1; });
  var idx = { _width: lastCol };
  var sheetName = this.def.name;
  this.def.columns.forEach(function (c) {
    if (!pos[c[1]]) throw new Error('シート「' + sheetName + '」に見出し「' + c[1] + '」がありません。1行目の見出しを元に戻してください。');
    idx[c[0]] = pos[c[1]];
  });
  this._index = idx;
  return idx;
};

/** 全行を {key: 文字列} の配列で返す（空行は除く）。_row に行番号。 */
Table_.prototype.all = function () {
  var idx = this.index();
  var lastRow = this.sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = this.sheet.getRange(2, 1, lastRow - 1, idx._width).getDisplayValues();
  var cols = this.def.columns;
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var obj = { _row: i + 2 };
    var empty = true;
    for (var j = 0; j < cols.length; j++) {
      var v = String(row[idx[cols[j][0]] - 1] || '').trim();
      obj[cols[j][0]] = v;
      if (v) empty = false;
    }
    if (!empty) out.push(obj);
  }
  return out;
};

Table_.prototype.append = function (obj) {
  var idx = this.index();
  var row = [];
  for (var i = 0; i < idx._width; i++) row.push('');
  this.def.columns.forEach(function (c) {
    var v = obj[c[0]];
    row[idx[c[0]] - 1] = v === undefined || v === null ? '' : (NUMBER_COLUMNS[c[0]] ? v : String(v));
  });
  this.sheet.appendRow(row);
  return this.sheet.getLastRow();
};

/** 指定行の一部の列だけ更新 */
Table_.prototype.update = function (rowNum, patch) {
  var idx = this.index();
  var sheet = this.sheet;
  Object.keys(patch).forEach(function (k) {
    if (!idx[k]) return;
    var v = patch[k];
    sheet.getRange(rowNum, idx[k]).setValue(v === undefined || v === null ? '' : (NUMBER_COLUMNS[k] ? v : String(v)));
  });
};

function table_(key) { return new Table_(key); }

// ---------- 便利関数 ----------

function findUser_(userId) {
  var rows = table_('users').all();
  for (var i = 0; i < rows.length; i++) if (rows[i].line_user_id === userId) return rows[i];
  return null;
}

/** 名簿に無ければ追加、あれば表示名を更新して返す */
function upsertUser_(userId, displayName) {
  if (!userId) return null;
  var t = table_('users');
  var rows = t.all();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].line_user_id === userId) {
      if (displayName && rows[i].display_name !== displayName) {
        t.update(rows[i]._row, { display_name: displayName, updated_at: nowStamp_() });
        rows[i].display_name = displayName;
      }
      return rows[i];
    }
  }
  var user = {
    line_user_id: userId,
    display_name: displayName || '',
    role: ROLE_LABEL.guest,
    memo: '',
    created_at: nowStamp_(),
    updated_at: nowStamp_()
  };
  user._row = t.append(user);
  return user;
}

function eventsById_(events) {
  var map = {};
  events.forEach(function (e) { map[e.event_id] = e; });
  return map;
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}
