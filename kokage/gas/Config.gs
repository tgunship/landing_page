/**
 * 木陰 — 設定
 *
 * 数値の設定は、Apps Script の「プロジェクトの設定 → スクリプト プロパティ」に
 * 同じ名前で値を入れると、コードを書き換えずに上書きできます。
 *
 * 秘密の値（トークン・APIキー）は必ずスクリプト プロパティに入れてください。コードには書かないこと。
 */
var DEFAULT_CONFIG = {
  // 最少人数の決まりはない（ホストだけでも開催）。中止の概念もない。
  NOTICE_DAYS_BEFORE: 3,       // 運営への「人数のお知らせ」：開催日の何日前か（会場の予約・人数確認用）
  NOTICE_HOUR: 12,             // 同：何時に送るか
  CORE_HOURS: 2,               // 本編の時間（この後、感想の投稿・フリートーク）
  EVENT_DURATION_HOURS: 3,     // 1回の時間（本編2時間＋投稿・フリートーク1時間）
  DEFAULT_START_TIME: '13:00',
  DEFAULT_VENUE: 'イバフォルニア・ベース',
  DEFAULT_MAX_PARTICIPANTS: 8, // 定員（ホストを含む。運営は含まない）
  VENUE_FEE: 500,              // イバフォルニア・ベースの場所代（1人。運営以外の全員）
  GUEST_FIRST_FEE: 1000,       // 一般・初回の参加費
  GUEST_REGULAR_FEE: 6000,     // 一般・2回目以降の参加費
  ACTION_DISCOUNT_AMOUNT: 1000,// 発信・口コミ（自己申告）割引
  PUSH_MONTHLY_LIMIT: 200,     // LINE公式アカウントの無料メッセージ通数（表示用）
  INSTAGRAM_URL: 'https://www.instagram.com/kokochi1205/',
  INSTAGRAM_HANDLE: '@kokochi1205',
  // 参加者向け画面（GitHub Pages）。LIFF の URL が設定されていればそちらを優先して案内に使う
  PAGE_URL: 'https://tgunship.github.io/landing_page/kokage/'
};

var NUMERIC_KEYS = [
  'NOTICE_DAYS_BEFORE', 'NOTICE_HOUR', 'CORE_HOURS', 'EVENT_DURATION_HOURS', 'DEFAULT_MAX_PARTICIPANTS',
  'VENUE_FEE', 'GUEST_FIRST_FEE', 'GUEST_REGULAR_FEE', 'ACTION_DISCOUNT_AMOUNT', 'PUSH_MONTHLY_LIMIT'
];

var _cfgCache = null;

function getConfig() {
  if (_cfgCache) return _cfgCache;
  var props = PropertiesService.getScriptProperties().getProperties();
  var cfg = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) { cfg[k] = DEFAULT_CONFIG[k]; });
  NUMERIC_KEYS.forEach(function (k) {
    if (props[k] !== undefined && props[k] !== '' && !isNaN(Number(props[k]))) cfg[k] = Number(props[k]);
  });
  ['DEFAULT_VENUE', 'DEFAULT_START_TIME', 'INSTAGRAM_URL', 'INSTAGRAM_HANDLE', 'PAGE_URL'].forEach(function (k) {
    if (props[k]) cfg[k] = props[k];
  });
  _cfgCache = cfg;
  return cfg;
}

/** スクリプト プロパティ（秘密の値など） */
function prop(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? (fallback === undefined ? '' : fallback) : v;
}

function adminIds() {
  return prop('ADMIN_LINE_USER_IDS').split(/[,\s]+/).filter(function (s) { return s; });
}

/**
 * 運営（うってぃ・ぎっしー）。ADMIN_LINE_USER_IDS に入っている人。
 * 運営は申込シートに登録せず、人数にも数えず、費用もかからない。管理者通知が届く。
 */
function isAdmin(userId) {
  return adminIds().indexOf(userId) >= 0;
}

/** 参加者向け画面へのリンク（イベント指定可） */
function entryLink(eventId) {
  var liffId = prop('LIFF_ID');
  var base = liffId ? 'https://liff.line.me/' + liffId : getConfig().PAGE_URL;
  return eventId ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 'event=' + encodeURIComponent(eventId) : base;
}

function isDryRun() {
  return String(prop('DRY_RUN')).toLowerCase() === 'true';
}
