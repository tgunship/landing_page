// 木陰 — インスタ用画像をブラウザ（canvas）で合成する
// レイヤー：背景（選択 or アップロード）→ 暗めの膜 → 文字 → 木陰フレーム（必ず最前面）
// kokage/assets/frame-post.png（1080×1350）を置くと、
// 組み込みの枠の代わりにその透過PNGを最前面に重ねます。
(function () {
  const SIZES = { post: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 } };
  const SERIF = '"Noto Serif JP", "Hiragino Mincho ProN", serif';
  const SANS = '"Zen Kaku Gothic New", "Hiragino Sans", sans-serif';
  const NO_START = '、。，．,.」』）)！？!?ー〜…ぁぃぅぇぉっゃゅょゎァィゥェォッャュョ';
  const frameCache = {};

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadFrame(format) {
    if (!(format in frameCache)) {
      frameCache[format] = await loadImage(`assets/frame-${format}.png`).catch(() => null);
    }
    return frameCache[format];
  }

  /** 日本語向けの1文字単位の折り返し（簡易禁則つき） */
  function wrap(ctx, text, maxWidth) {
    const out = [];
    String(text || '').split('\n').forEach((para) => {
      let line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > maxWidth && line && NO_START.indexOf(ch) < 0) {
          out.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      out.push(line);
    });
    return out;
  }

  function coverDraw(ctx, img, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function spacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  async function ensureFonts(texts) {
    if (!document.fonts || !document.fonts.load) return;
    const all = texts.join('') + '木陰KOKAGE0123456789';
    await Promise.all([
      document.fonts.load(`600 80px "Noto Serif JP"`, all),
      document.fonts.load(`500 36px "Zen Kaku Gothic New"`, all),
      document.fonts.load(`700 36px "Zen Kaku Gothic New"`, all)
    ]).catch(() => {});
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{format:'post'|'story', bg:HTMLImageElement|null, title:string, description:string,
   *          dateLabel:string, time:string, venue:string, handle:string}} o
   */
  async function draw(canvas, o) {
    const { w, h } = SIZES[o.format] || SIZES.post;
    const story = o.format === 'story';
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    await ensureFonts([o.title, o.description, o.dateLabel, o.time, o.venue, o.handle]);

    // 1. 背景
    if (o.bg) {
      coverDraw(ctx, o.bg, w, h);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#2f6f62'); g.addColorStop(1, '#0a4a4f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // 2. 文字を読みやすくする膜
    ctx.fillStyle = 'rgba(8, 38, 40, 0.40)';
    ctx.fillRect(0, 0, w, h);
    const g2 = ctx.createLinearGradient(0, h * 0.2, 0, h);
    g2.addColorStop(0, 'rgba(8,38,40,0)'); g2.addColorStop(1, 'rgba(8,38,40,0.45)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 12;

    // 3. ブランド名
    const topY = story ? 300 : 170;
    ctx.font = `600 66px ${SERIF}`; spacing(ctx, 24);
    ctx.fillText('木陰', w / 2 + 12, topY);
    ctx.font = `500 22px ${SANS}`; spacing(ctx, 8);
    ctx.fillText('KOKAGE  ｜  ここち', w / 2 + 4, topY + 46);
    spacing(ctx, 0);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2 - 40, topY + 84); ctx.lineTo(w / 2 + 40, topY + 84); ctx.stroke();
    ctx.shadowBlur = 12;

    // 4. 下部の日時パネルの位置
    const panelH = 260;
    const panelY = h - (story ? 330 : 96) - panelH;

    // 5. タイトル・案内文（入りきるまで文字を小さくする）
    const areaTop = topY + 150;
    const areaBottom = panelY - 50;
    let tSize = 82, dSize = 38, tLines, dLines, tH, dH;
    for (let i = 0; i < 12; i++) {
      ctx.font = `600 ${tSize}px ${SERIF}`;
      tLines = wrap(ctx, o.title, w - 220);
      ctx.font = `500 ${dSize}px ${SANS}`;
      dLines = wrap(ctx, o.description, w - 240);
      tH = tLines.length * tSize * 1.45;
      dH = dLines.length * dSize * 1.75;
      if (tH + 44 + dH <= areaBottom - areaTop) break;
      tSize = Math.max(52, tSize - 6); dSize = Math.max(28, dSize - 2);
    }
    let y = areaTop + Math.max(0, (areaBottom - areaTop - (tH + 44 + dH)) / 2);
    ctx.font = `600 ${tSize}px ${SERIF}`;
    tLines.forEach((line) => { y += tSize * 1.45; ctx.fillText(line, w / 2, y - tSize * 0.35); });
    y += 44;
    ctx.font = `500 ${dSize}px ${SANS}`;
    dLines.forEach((line) => { y += dSize * 1.75; ctx.fillText(line, w / 2, y - dSize * 0.5); });

    // 6. 日時・場所パネル
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    roundRect(ctx, 90, panelY, w - 180, panelH, 24); ctx.fill();
    ctx.fillStyle = '#0a4a4f';
    ctx.font = `600 54px ${SERIF}`;
    ctx.fillText(o.dateLabel || '', w / 2, panelY + 84);
    ctx.fillStyle = '#2c3a3b';
    ctx.font = `500 32px ${SANS}`;
    ctx.fillText(`${o.time || ''}　｜　${o.venue || ''}`, w / 2, panelY + 146, w - 240);
    ctx.fillStyle = '#12838b';
    ctx.font = `700 26px ${SANS}`;
    ctx.fillText(`お申し込みは ${o.handle || ''} のプロフィールから（公式LINE）`, w / 2, panelY + 210, w - 230);

    // 7. 木陰フレーム（必ず最前面）
    const frame = await loadFrame(o.format);
    if (frame) {
      ctx.drawImage(frame, 0, 0, w, h);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3;
      roundRect(ctx, 38, 38, w - 76, h - 76, 18); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      roundRect(ctx, 52, 52, w - 104, h - 104, 12); ctx.stroke();
    }
  }

  window.KokagePoster = { draw, loadImage, SIZES };
})();
