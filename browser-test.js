/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * ★ アプリを作ったら「ここにアプリごとの確認を足す」に書き足すこと。
 *   直した不具合には、かならず見張り役をここに置く。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/**
 * 何かした直後に、その要素が本来の場所からどれだけずれるかを
 * 1 フレームずつ測る。「置いた瞬間に一瞬とぶ」たぐいの不具合はこれで見つかる。
 *
 * @returns {Promise<number>} 最大のずれ (px)
 */
function measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    // 対象は iPhone 16 Plus だけ。playwright が名前を知らなければ同じ大きさの端末で代える
    const DEVICE = devices['iPhone 16 Plus'] || devices['iPhone 15 Plus'] || {
      viewport: { width: 430, height: 739 }, screen: { width: 430, height: 932 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true
    };
    section('スマホで開く');
    const context = await browser.newContext({ ...DEVICE });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__app);
    ok(true, 'ページが開いて、画面のしくみが立ち上がる');

    const fit = await phone.evaluate(() => ({
      width: innerWidth,
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : ''
    }));
    ok(fit.width === 430, `幅が iPhone 16 Plus と同じ (${fit.width})`);
    ok(fit.wide <= 1, 'スマホ幅で横スクロールが出ない');
    ok(fit.title.length > 0, `見出しが出ている (${fit.title})`);

    // ------------------------------------------------ せってい
    section('せってい');
    const rowCount = () => phone.locator('#rows .row').count();
    ok(await rowCount() === 6, `はじめは 6 人 (${await rowCount()})`);
    for (let i = 0; i < 6; i++) await phone.locator('#plus').tap();
    ok(await rowCount() === 12 && await phone.locator('#plus').isDisabled(),
      `12 人で止まり、＋が押せなくなる (${await rowCount()})`);
    const wide12 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(wide12 <= 1, `12 人でも横スクロールが出ない (${wide12}px)`);
    for (let i = 0; i < 10; i++) await phone.locator('#minus').tap();
    ok(await rowCount() === 2 && await phone.locator('#minus').isDisabled(),
      `2 人で止まり、−が押せなくなる (${await rowCount()})`);

    await phone.locator('.presets [data-p="order"]').tap();
    const order = await phone.$$eval('#rows .rs', (els) => els.map((e) => e.value));
    ok(order.join() === '1,2', `「じゅんばん」で 1,2… が入る (${order.join()})`);
    await phone.locator('.presets [data-p="one"]').tap();

    // 入れた名前が、開き直しても残る
    await phone.locator('#rows .nm').first().fill('たなかたろう');
    await phone.evaluate(() => window.__app.saveNow());
    await phone.reload();
    await phone.waitForFunction(() => window.__app);
    const kept = await phone.locator('#rows .nm').first().inputValue();
    ok(kept === 'たなかたろう', `入れた名前が開き直しても残る (${kept})`);

    // ------------------------------------------------ 1 人ずつたどる (4 人・横書き)
    section('1 人ずつたどる');
    await phone.locator('#plus').tap();
    await phone.locator('#plus').tap();
    await phone.locator('#go').tap();
    ok(await phone.locator('#play').isVisible() && await phone.locator('.nmb').count() === 4,
      'はじめると 4 人ぶんの名前が並ぶ');

    // 動いているか (見えていない画面は rAF が止まるので前に出してから測る)
    await phone.bringToFront();
    await phone.locator('.nmb').nth(1).tap();
    const t1 = await phone.evaluate(async () => {
      const p = window.__app.players()[1];
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
      const a = p.t;
      await new Promise((r) => setTimeout(r, 300));
      return { a: a, b: p.t, run: p.run };
    });
    ok(t1.b > t1.a + 50, `タップすると線をたどって進む (${Math.round(t1.a)} → ${Math.round(t1.b)}px / 0.3秒)`);
    await phone.waitForFunction(() => window.__app.players()[1].done, null, { timeout: 8000 });

    const one = await phone.evaluate(() => {
      const G = window.__app.game();
      const end = G.paths[1].end;
      const slot = document.querySelectorAll('.slot')[end];
      const opened = [...document.querySelectorAll('.slot.open')].length;
      return {
        want: G.slot[end] || '—', got: slot.textContent, open: slot.classList.contains('open'), opened: opened,
        sum: [...document.querySelectorAll('#sum li')].map((li) => li.textContent),
        name: document.querySelectorAll('.nmb')[1].textContent,
        disabled: document.querySelectorAll('.nmb')[1].disabled
      };
    });
    ok(one.open && one.got === one.want && one.opened === 1,
      `着いた所だけが開き、その結果が出る (${one.got})`);
    ok(one.sum.length === 1 && one.sum[0] === one.name + one.want, `下の一覧にも出る (${one.sum.join()})`);
    ok(one.disabled, 'たどり終えた名前はもう押せない');

    // 線の色が、着いた縦線の下端に描かれている (ずれた位置でも確かめる: 0 番以外の人)
    const px = await phone.evaluate(() => {
      const G = window.__app.game();
      const cv = document.getElementById('cv');
      const n = G.ladder.n, end = G.paths[1].end;
      const dpr = cv.width / cv.clientWidth;
      const x = Math.round((end + 0.5) * cv.clientWidth / n * dpr);
      const y = Math.round((cv.clientHeight - 4) * dpr);
      const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    // COLORS[1] = #F2B134 (242,177,52)
    const near = Math.abs(px[0] - 242) + Math.abs(px[1] - 177) + Math.abs(px[2] - 52);
    ok(near < 40, `着いた縦線の下端が、その人の色で塗られている (rgb ${px.join(',')})`);

    // よこ線をみせる
    const rungLabel0 = await phone.locator('#rung').textContent();
    await phone.locator('#rung').tap();
    const rungLabel1 = await phone.locator('#rung').textContent();
    ok(rungLabel0 !== rungLabel1, `よこ線の表示を切り替えられる (${rungLabel0} → ${rungLabel1})`);
    await phone.locator('#rung').tap();

    // ------------------------------------------------ ぜんぶたどる (12 人・縦書き)
    section('ぜんぶたどる (12 人)');
    await phone.locator('#back').tap();
    for (let i = 0; i < 8; i++) await phone.locator('#plus').tap();
    await phone.locator('#rows .rs').nth(3).fill('おかしかかり');
    await phone.locator('#rows .nm').nth(9).fill('10');
    await phone.locator('#go').tap();
    await phone.evaluate(() => window.__app.setSpeed(4000));
    const wide12p = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(wide12p <= 1, `12 人のはしごで横スクロールが出ない (${wide12p}px)`);
    await phone.locator('#all').tap();
    await phone.waitForFunction(() => window.__app.players().every((p) => p.done), null, { timeout: 15000 });
    const all = await phone.evaluate(() => {
      const G = window.__app.game();
      const slots = [...document.querySelectorAll('.slot')];
      let bad = 0;
      G.paths.forEach((p) => { if (slots[p.end].textContent !== (G.slot[p.end] || '—')) bad++; });
      return {
        open: slots.filter((s) => s.classList.contains('open')).length,
        bad: bad, sum: document.querySelectorAll('#sum li').length,
        disabled: document.getElementById('all').disabled
      };
    });
    ok(all.open === 12 && all.bad === 0, `12 か所すべてが開き、どれも正しい結果 (開いた ${all.open} / 食い違い ${all.bad})`);
    ok(all.sum === 12 && all.disabled, `一覧が 12 行になり、「ぜんぶたどる」は押せなくなる`);

    // 縦に積んだ字が重ならず、箱からはみ出さない (writing-mode に任せると重なることがある)
    const tate = await phone.evaluate(() => {
      const out = [];
      for (const sel of ['.nmb', '.slot']) {
        for (const box of document.querySelectorAll(sel)) {
          const r = box.getBoundingClientRect();
          const cs = [...box.querySelectorAll('.tate > span')].map((s) => s.getBoundingClientRect());
          let minGap = Infinity, outside = 0;
          for (let i = 0; i < cs.length; i++) {
            if (i) minGap = Math.min(minGap, cs[i].top - cs[i - 1].top);
            if (cs[i].bottom > r.bottom + 0.5 || cs[i].top < r.top - 0.5) outside++;
          }
          out.push({ sel: sel, chars: cs.length, minGap: minGap, outside: outside, text: box.textContent });
        }
      }
      return out;
    });
    const ten = tate.find((t) => t.sel === '.nmb' && t.text === '10');
    ok(ten && ten.chars === 1, `「10」は割らずに 1 つの箱に入る (${ten && ten.chars} 箱)`);
    const longName = tate.find((t) => t.text === 'たなかたろう');
    const longRes = tate.find((t) => t.text === 'おかしかかり');
    ok(tate.every((t) => t.chars > 0), '名前も結果も 1 字ずつ縦に積まれている');
    ok(tate.every((t) => t.minGap >= 13), `字と字の送りが 13px 以上 (最小 ${Math.min(...tate.map((t) => t.minGap))}px)`);
    ok(longName && longName.outside === 0 && longName.chars === 6, '6 字の名前が箱に収まる');
    ok(longRes && longRes.outside === 0, `長い結果も箱に収まる (${longRes && longRes.text})`);

    // ------------------------------------------------ 途中で戻る・作り直す
    section('途中で戻る・作り直す');
    await phone.evaluate(() => window.__app.setSpeed(420));
    await phone.locator('#again').tap();
    const fresh = await phone.evaluate(() => ({
      open: document.querySelectorAll('.slot.open').length,
      done: window.__app.players().filter((p) => p.done).length,
      all: document.getElementById('all').disabled
    }));
    ok(fresh.open === 0 && fresh.done === 0 && !fresh.all, '「つくりなおす」で、まっさらになる');
    await phone.locator('#all').tap();
    await phone.waitForTimeout(200);
    await phone.locator('#back').tap();
    await phone.waitForTimeout(300);
    await phone.locator('#go').tap();
    const again = await phone.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return {
        running: window.__app.players().filter((p) => p.run || p.done).length,
        open: document.querySelectorAll('.slot.open').length
      };
    });
    ok(again.running === 0 && again.open === 0, '途中で戻ってはじめ直すと、前の動きを引きずらない');

    // ------------------------------------------------ 明るい画面・暗い画面
    section('明るい画面と暗い画面');
    for (const scheme of ['light', 'dark']) {
      const themed = await browser.newContext({ ...DEVICE, colorScheme: scheme });
      const page = await themed.newPage();
      page.on('pageerror', (e) => errors.push(scheme + ': ' + e.message));
      await page.goto(URL);
      await page.waitForFunction(() => window.__app);
      const colors = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        fg: getComputedStyle(document.body).color
      }));
      ok(colors.bg !== colors.fg, `${scheme}: 文字と背景の色が違う (${colors.bg} / ${colors.fg})`);
      await themed.close();
    }

    // ------------------------------------------------ アイコン (用意していれば)
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    if (!apple) {
      skip('ホーム画面用のアイコンはまだ無い (PWA にするときに用意する)');
    } else {
      // iOS は SVG のアイコンを使えない
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok(), `${apple} が配信される`);
    }

    // ------------------------------------------------ 更新とオフライン (sw.js があれば)
    section('更新とオフライン');
    if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
      skip('サービスワーカーはまだ無い (オフライン対応するときに用意する)');
    } else {
      const swCtx = await browser.newContext();
      const swPage = await swCtx.newPage();
      await swPage.goto(URL);
      await swPage.waitForFunction(() => window.__app);
      ok(await swPage.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
        'サービスワーカーが動く');
      await swPage.waitForTimeout(800);

      // 直したものが 1 回のリロードで出るか (キャッシュ優先だと古い画面が出る)
      const indexPath = path.join(ROOT, 'index.html');
      const original = fs.readFileSync(indexPath, 'utf8');
      const marker = original.match(/<h1[^>]*>([^<]*)<\/h1>/);
      fs.writeFileSync(indexPath, original.replace(marker[1], 'こうしんかくにん'));
      await swPage.reload();
      await swPage.waitForTimeout(400);
      const title = await swPage.textContent('h1');
      fs.writeFileSync(indexPath, original);
      ok(title.trim() === 'こうしんかくにん', `直したものが 1 回のリロードで出る (${title.trim()})`);

      await swPage.reload();
      await swPage.waitForTimeout(500);
      await swCtx.setOffline(true);
      await swPage.reload().catch(() => {});
      await swPage.waitForTimeout(400);
      ok(await swPage.evaluate(() => !!window.__app).catch(() => false),
        'ネットにつながらなくても開ける');
      await swCtx.setOffline(false);
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
