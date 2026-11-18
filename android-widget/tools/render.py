import sys, json, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from cards import PAIN, WISH
FONT = '../font/package/700Bold/NotoSansJP_700Bold.ttf'
OUT = sys.argv[1]
W, H = 960, 624
TEAL = (0x12, 0x83, 0x8b)
def font(sz): return ImageFont.truetype(FONT, sz)

def measure(path, kind):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    h, w, _ = a.shape
    a = a[6:h-6, 6:w-6]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r < 110) & (g > 80) & (b > 90) if kind == 'w' else (r > 200) & (g > 200) & (b > 200)
    rows = np.where(m.any(1))[0]
    # split into lines by gaps
    lines = []; start = rows[0]; prev = rows[0]
    for y in rows[1:]:
        if y - prev > 3: lines.append((start, prev)); start = y
        prev = y
    lines.append((start, prev))
    res = []
    for y0, y1 in lines:
        cols = np.where(m[y0:y1+1].any(0))[0]
        res.append(dict(cx=(cols[0]+cols[-1])/2+6 - w/2, cy=(y0+y1)/2+6 - h/2, w=cols[-1]-cols[0]+1, h=y1-y0+1))
    return res, w, h

def ink(text, sz):
    f = font(sz); bb = f.getbbox(text)
    return bb  # x0,y0,x1,y1 relative to origin

def render(text, kind, idx):
    lines = text.split('\n')
    meas, ow, oh = measure('orig_%s%02d.png' % (kind, idx), kind)
    if len(meas) != len(lines):
        print('LINE MISMATCH', kind, idx, len(meas), lines); meas = None
    s = W / ow
    # font size from widest line
    j = max(range(len(lines)), key=lambda k: meas[k]['w'])
    bb = ink(lines[j], 200)
    fs = 200 * meas[j]['w'] * s / (bb[2] - bb[0])
    fs = round(fs)
    card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    R = 30
    if kind == 'w':
        d.rounded_rectangle((1, 1, W-2, H-2), R, fill=(255, 255, 255, 255), outline=(120, 120, 120, 255), width=3)
        fg = TEAL + (255,); shc = (0, 0, 0, 80)
    else:
        d.rounded_rectangle((1, 1, W-2, H-2), R, fill=TEAL + (255,), outline=(20, 60, 64, 255), width=3)
        fg = (255, 255, 255, 255); shc = (0, 0, 0, 110)
    mask = Image.new('L', (W, H), 0); md = ImageDraw.Draw(mask)
    f = font(fs)
    # 行間は元画像の実測値を使い、文字ブロック全体はカードの縦中央に揃える
    top = meas[0]['cy'] - meas[0]['h']/2; bot = meas[-1]['cy'] + meas[-1]['h']/2
    shift = -(top + bot) / 2
    for k, ln in enumerate(lines):
        bb = f.getbbox(ln)
        x = W/2 - (bb[0]+bb[2])/2
        y = H/2 + (meas[k]['cy']+shift)*s - (bb[1]+bb[3])/2
        md.text((x, y), ln, font=f, fill=255)
    sh = Image.new('L', (W, H), 0); sh.paste(mask, (4, 4))
    sh = sh.filter(ImageFilter.GaussianBlur(4))
    shl = Image.new('RGBA', (W, H), shc); shl.putalpha(sh.point(lambda v: v*shc[3]//255))
    card = Image.alpha_composite(card, shl)
    txt = Image.new('RGBA', (W, H), fg); txt.putalpha(mask)
    card = Image.alpha_composite(card, txt)
    return card, fs

info = {}
for kind, arr, name in (('p', PAIN, 'pain'), ('w', WISH, 'wish')):
    for i, t in enumerate(arr, 1):
        c, fs = render(t, kind, i)
        c.save('%s/%s_%02d.webp' % (OUT, name, i), 'WEBP', lossless=True, quality=100, method=4)
        c.save('prev_%s_%02d.png' % (name, i))
        info['%s%d' % (kind, i)] = fs
print(info)
