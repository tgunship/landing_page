/**
 * 木陰 — Gemini API（タイトル・案内文・インスタ投稿文の下書きを作る）
 * 無料枠で使う想定。GEMINI_API_KEY をスクリプト プロパティに設定してください。
 * モデルは GEMINI_MODEL で変更できます（既定: gemini-2.5-flash）。
 */
function generateCopy_(input) {
  var key = prop('GEMINI_API_KEY');
  if (!key) throw new Error('スクリプト プロパティ GEMINI_API_KEY が未設定です');
  var model = prop('GEMINI_MODEL', 'gemini-2.5-flash');

  var prompt = [
    'あなたは「ここち」という内面探求の場の、やわらかく誠実なコピーライターです。',
    '「木陰」は、慌ただしい日常から、ふうっと一息つける場所。評価・判断しない、アドバイスしない、',
    '人のせいでも自分のせいでもなく、自分を見つめ、自分の願いとつながる時間です。',
    'ライフクエストの仲間がホストとなり、はじめての方を迎え入れます。',
    '',
    '次の「企画の想い」をもとに、Instagram投稿と申し込み画面に載せる文章をつくってください。',
    '',
    '# ルール',
    '- やさしく、静かで、押しつけない言葉。煽り・誇張・「必ず変われる」などの約束はしない',
    '- 専門用語や横文字は控えめに。読む人が「自分のことかも」と感じられる具体性を少しだけ',
    '- 日時・場所・料金は書かない（別の場所に自動で入ります）',
    '- 絵文字は使わない',
    '',
    '# 出力（JSONのみ）',
    '{',
    '  "title": "イベントタイトル（全角20文字以内）",',
    '  "description": "申し込み画面と画像に載せる短い案内文（全角50〜80文字）",',
    '  "caption": "Instagram投稿の本文（全角150〜300文字、改行あり、ハッシュタグは書かない）"',
    '}',
    '',
    '# 企画の想い',
    String(input.idea || '').slice(0, 3000),
    input.hostName ? '\n# ホスト\n' + input.hostName : ''
  ].join('\n');

  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.9 }
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gemini API エラー（' + res.getResponseCode() + '）: ' + res.getContentText().slice(0, 300));
  }
  var body = JSON.parse(res.getContentText());
  var text = body.candidates && body.candidates[0] && body.candidates[0].content &&
    body.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('Gemini から文章が返ってきませんでした。もう一度お試しください。');
  var json;
  try {
    json = JSON.parse(text.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim());
  } catch (err) {
    throw new Error('Gemini の出力を読み取れませんでした。もう一度お試しください。');
  }
  return {
    title: String(json.title || '').trim(),
    description: String(json.description || '').trim(),
    caption: String(json.caption || '').trim()
  };
}
