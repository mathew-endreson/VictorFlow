#!/usr/bin/env node
/**
 * Browser smoke test of the Definition of Done, driving the REAL desktop UI against the REAL API:
 *   log in → create customer → create + confirm order (live totals) → move it through the Kanban (server-validated,
 *   incl. the "all work orders completed" guard) → balanced invoice → payments → ledger → licence → public tracking page.
 * It then switches the app to Arabic and checks the right-to-left layout on the key screens (direction, mirrored
 * navigation and Kanban, amounts and dates in Arabic, Arabic account names, the tracker in Arabic), and back to English.
 *
 *   pnpm dev:up                # in one terminal (API :3000, tracker :3001, desktop :1420)
 *   pnpm ui:smoke              # in another; needs Chrome, Edge or Chromium (set BROWSER_PATH to choose)
 *   UI_URL=http://localhost:1430/ pnpm ui:smoke     # against a desktop dev server on another port
 *
 * It creates demo data (a customer, an order, an invoice) in the dev database — never run it against real data.
 * Screenshots of every step land in scripts/ui-smoke/shots/.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UI = process.env.UI_URL ?? 'http://localhost:1420/';
const ADMIN = { email: process.env.SMOKE_EMAIL ?? 'admin@victorflow.local', password: process.env.SMOKE_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? 'Admin123!' };
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const installed = CANDIDATES.filter((p) => existsSync(p));
if (installed.length === 0) {
  console.error('No Chrome/Edge/Chromium found. Install one, or set BROWSER_PATH to its executable.');
  process.exit(2);
}

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// Use the first installed browser that actually STARTS (a browser that is mid-update can exit at once in headless mode).
let browser;
const launchErrors = [];
for (const executablePath of installed) {
  try {
    browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--window-size=1440,900'], defaultViewport: { width: 1440, height: 900 } });
    break;
  } catch (e) {
    launchErrors.push(`${executablePath}: ${String(e.message).split('\n')[0]}`);
  }
}
if (!browser) {
  console.error(`None of the installed browsers could be started:\n  ${launchErrors.join('\n  ')}\nInstall Chrome or Edge, or set BROWSER_PATH.`);
  process.exit(2);
}
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.bringToFront();
  return page.screenshot({ path: `${SHOTS}${name}.png` });
};
// amounts use a narrow no-break space (U+202F) as thousands separator; compare with plain spaces
const norm = (t) => t.replace(/[\u202f\u00a0]/g, ' ').replace(/[\u2066-\u2069]/g, ''); // also drop the invisible bidi isolates around Arabic amounts
const text = async () => norm(await page.evaluate(() => document.body.innerText));
// innerText applies CSS text-transform (headings are upper-cased), so match case-insensitively
const waitText = (t, timeout = 15000) =>
  page.waitForFunction((x) => document.body.innerText.replace(/[\u202f\u00a0]/g, ' ').toLowerCase().includes(x.toLowerCase()), { timeout }, t);
const go = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await sleep(300);
};

async function setByLabel(label, value) {
  const done = await page.evaluate((label, value) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(label));
    const el = l && document.getElementById(l.htmlFor);
    if (!el) return false;
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); // bypass React's value tracker
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  }, label, value);
  if (!done) throw new Error(`no field labelled "${label}"`);
}
async function setByAria(aria, value) {
  const done = await page.evaluate((aria, value) => {
    const el = document.querySelector(`[aria-label="${aria}"]`);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, aria, value);
  if (!done) throw new Error(`no element aria-label "${aria}"`);
}
async function clickButton(label, scope = 'body') {
  const clicked = await page.evaluate((label, scope) => {
    const root = document.querySelector(scope) ?? document;
    const b = [...root.querySelectorAll('button, a')].find((x) => x.textContent.trim() === label && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, label, scope);
  if (!clicked) throw new Error(`no enabled button "${label}"`);
  await sleep(150);
}
const toastText = () => page.evaluate(() => [...document.querySelectorAll('[aria-live="polite"] > div')].map((d) => d.textContent).join(' | '));

/** HTML5 drag-and-drop with the events spaced out so React re-renders between them, like a real drag. */
async function drag(cardNumber, column) {
  await page.evaluate(async (num, col) => {
    const card = document.querySelector(`[data-card="${num}"]`);
    const target = document.querySelector(`[data-column="${col}"]`);
    if (!card || !target) throw new Error(`card ${num} or column ${col} not found`);
    const dt = new DataTransfer();
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    fire(card, 'dragstart'); await wait(80);
    fire(target, 'dragenter'); fire(target, 'dragover'); await wait(80);
    fire(target, 'drop'); await wait(40);
    fire(card, 'dragend');
  }, cardNumber, column);
  await sleep(700);
}
const columnHas = (col, num) => page.evaluate((c, n) => !!document.querySelector(`[data-column="${c}"] [data-card="${n}"]`), col, num);

try {
  // ── 1. login ────────────────────────────────────────────────────────────────
  await page.goto(UI, { waitUntil: 'networkidle0' });
  await waitText('Sign in to continue');
  ok(page.url().includes('#/login'), 'unauthenticated visit lands on the login screen');

  await setByLabel('Email', ADMIN.email);
  await setByLabel('Password', 'definitely-not-the-password');
  await clickButton('Sign in');
  await waitText('Invalid email or password');
  ok(true, "wrong password shows the server's error");

  await setByLabel('Password', ADMIN.password);
  await clickButton('Sign in');
  await waitText('Executive dashboard');
  const dash = await text();
  ok(/Revenue this month/i.test(dash) && /Unpaid invoices/i.test(dash) && /Production pipeline/i.test(dash), 'login works; the dashboard shows revenue, unpaid invoices and the production pipeline');
  await shot('01-dashboard');

  // ── 2. create a customer ────────────────────────────────────────────────────
  const customerName = `Café UI Test ${Date.now() % 100000}`;
  await go('#/customers');
  await waitText('New customer');
  await clickButton('New customer');
  await waitText('Custom fields');
  await setByLabel('Name', customerName);
  await setByLabel('Wilaya', 'Alger');
  await setByLabel('Phone', '0555 00 11 22');
  await clickButton('Add field', '[role=dialog]');
  await setByAria('Field name', 'source');
  await setByAria('Field value', 'ui-test');
  await shot('02-new-customer');
  await clickButton('Create customer');
  await waitText(customerName);
  await waitText('source: ui-test');
  ok(page.url().includes('#/customers/'), `customer "${customerName}" created; its detail page opened with the custom field`);
  await shot('03-customer-detail');

  // ── 3. create + confirm an order, with live totals ──────────────────────────
  await clickButton('New order');
  await waitText('Amounts update as you type');
  await setByAria('Line 1 description', 'Enseigne caisson 3 m');
  await setByAria('Line 1 quantity', '3');
  await setByAria('Line 1 unit price', '1250.50');
  await sleep(200);
  const ttc = norm(await page.$eval('[data-testid=total-ttc]', (e) => e.textContent));
  ok(ttc.includes('4 464,29'), `live TTC preview is 4 464,29 DA (got "${ttc}")`);
  await shot('04-order-editor');
  await clickButton('Save & confirm');
  await page.waitForFunction(() => /ORD-\d{4}-\d{6}/.test(document.body.innerText) && document.body.innerText.includes('Customer tracking'), { timeout: 15000 });
  const orderText = await text();
  const orderNumber = orderText.match(/ORD-\d{4}-\d{6}/)[0];
  const poNumber = orderText.match(/PRD-\d{4}-\d{6}/)?.[0];
  ok(/Confirmed/i.test(orderText) && !!poNumber, `order ${orderNumber} confirmed; production order ${poNumber} created`);
  ok(orderText.includes('4 464,29'), 'the order shows the same TTC total as the preview');

  const trackingUrl = await page.$eval('input[aria-label="Public tracking URL"]', (e) => e.value);
  const hasQr = await page.$eval('img[alt*="QR code"]', (e) => e.src.startsWith('data:image/png') && e.naturalWidth > 0);
  ok(/^https?:\/\/[^/]+\/t\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{43}$/.test(trackingUrl) && hasQr, `the order page shows a QR code and the tracking URL ${trackingUrl.slice(0, 48)}…`);
  await shot('05-order-confirmed');

  // ── 4. Kanban: every move is decided by the server ──────────────────────────
  await go('#/production');
  await waitText('Production board');
  await page.waitForSelector(`[data-card="${poNumber}"]`);
  ok(await columnHas('DRAFT', poNumber), `card ${poNumber} starts in DRAFT`);
  await shot('06-kanban-start');

  await drag(poNumber, 'COMPLETED');
  let toast = await toastText();
  ok(/not allowed/i.test(toast) && (await columnHas('DRAFT', poNumber)), 'illegal drop DRAFT → COMPLETED is REJECTED by the server and the card stays put');

  await drag(poNumber, 'CONFIRMED');
  ok(await columnHas('CONFIRMED', poNumber), 'DRAFT → CONFIRMED works');
  await drag(poNumber, 'IN_PRODUCTION');
  ok(await columnHas('IN_PRODUCTION', poNumber), 'CONFIRMED → IN_PRODUCTION works');

  await drag(poNumber, 'QUALITY_CHECK');
  toast = await toastText();
  ok(/work order/i.test(toast) && /not COMPLETED/i.test(toast) && (await columnHas('IN_PRODUCTION', poNumber)), 'GUARD: QUALITY_CHECK is refused while work orders are open (the toast names them)');
  await shot('07-kanban-guard');

  await page.evaluate((n) => document.querySelector(`[data-card="${n}"]`).click(), poNumber);
  await waitText('Work orders');
  for (let i = 0; i < 3; i++) {
    await clickButton('Complete', '[role=dialog]');
    await sleep(500);
  }
  ok(((await text()).match(/Completed/g) ?? []).length >= 3, 'all three work orders completed from the card drawer');
  await shot('08-drawer');
  await page.keyboard.press('Escape');
  await sleep(300);

  await drag(poNumber, 'QUALITY_CHECK');
  ok(await columnHas('QUALITY_CHECK', poNumber), 'guard satisfied: QUALITY_CHECK now succeeds');
  await drag(poNumber, 'COMPLETED');
  ok(await columnHas('COMPLETED', poNumber), 'QUALITY_CHECK → COMPLETED (admin holds the approve permission)');
  await shot('09-kanban-done');

  // ── 5. invoice + payments ───────────────────────────────────────────────────
  await go('#/invoices');
  await waitText('Generate invoice');
  await clickButton('Generate invoice');
  await waitText('Generate invoice from order');
  await page.waitForFunction((n) => [...document.querySelectorAll('[role=dialog] option')].some((o) => o.textContent.includes(n)), { timeout: 10000 }, orderNumber);
  await setByLabel('Order', await page.evaluate((n) => [...document.querySelectorAll('[role=dialog] option')].find((o) => o.textContent.includes(n)).value, orderNumber));
  await sleep(200);
  const preview = norm(await page.evaluate(() => document.querySelector('[role=dialog]').innerText));
  ok(/Dr 411/.test(preview) && /Cr 701/.test(preview) && /Cr 44571/.test(preview), 'the dialog previews the 411 / 701 / 44571 posting');
  await clickButton('Issue invoice');
  await page.waitForFunction(() => /Invoice INV-\d{4}-\d{6}/.test(document.body.innerText) && document.body.innerText.includes('Balance due'), { timeout: 15000 });
  const invText = await text();
  const invoiceNumber = invText.match(/INV-\d{4}-\d{6}/)[0];
  ok(invText.includes('3 751,50') && invText.includes('712,79') && invText.includes('4 464,29'), `invoice ${invoiceNumber}: HT 3 751,50 + TVA 712,79 = TTC 4 464,29`);
  ok(/VTE\/\d{4}\/\d{6}/.test(invText), 'the invoice links to its ledger entry number');
  await shot('10-invoice');

  await clickButton('Record payment');
  await waitText('Posts');
  const prefilled = await page.evaluate(() => document.getElementById([...document.querySelectorAll('label')].find((x) => x.textContent.includes('Amount')).htmlFor).value);
  ok(prefilled === '4464.29', `the payment form pre-fills the balance due (${prefilled})`);
  await setByLabel('Amount', '1000');
  await clickButton('Record payment', '[aria-label="Record payment"]');
  await page.waitForFunction(() => document.body.innerText.includes('Partially paid'), { timeout: 10000 });
  ok(true, 'a partial payment of 1 000,00 → status Partially paid');
  await clickButton('Record payment');
  await waitText('Posts');
  await clickButton('Record payment', '[aria-label="Record payment"]');
  await page.waitForFunction(() => /\bPaid\b/.test(document.querySelector('[role=dialog]')?.innerText ?? ''), { timeout: 10000 });
  const balance = norm(await page.$eval('[data-testid=balance-due]', (e) => e.textContent));
  ok(/^0,00/.test(balance), `paying the remainder settles the invoice (balance due ${balance})`);
  await shot('11-paid');
  await page.keyboard.press('Escape');

  // ── 6. ledger ───────────────────────────────────────────────────────────────
  await go('#/ledger');
  await waitText('Journal entries');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, invoiceNumber);
  await page.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(n)).click(), invoiceNumber);
  await page.waitForSelector('table[aria-label^="Lines of VTE"]');
  const lines = norm(await page.$eval('table[aria-label^="Lines of VTE"]', (e) => e.innerText));
  ok(lines.includes('411') && lines.includes('701') && lines.includes('44571') && lines.includes('4 464,29'), 'the ledger shows the invoice entry with its 411 / 701 / 44571 lines');
  await shot('12-ledger');
  await clickButton('Trial balance');
  await waitText('Balanced');
  ok(true, 'the trial balance reports Balanced');

  // ── 7. licence ──────────────────────────────────────────────────────────────
  await go('#/license');
  await waitText('Entitlement');
  const lic = await text();
  ok(/PROFESSIONAL/.test(lic) && /Valid/.test(lic), 'the License screen shows a valid PROFESSIONAL entitlement');
  await shot('13-license');

  // ── 8. the public tracking page a customer would open ───────────────────────
  const tracker = await browser.newPage();
  await tracker.goto(trackingUrl, { waitUntil: 'networkidle0' });
  const tt = norm(await tracker.evaluate(() => document.body.innerText));
  ok(tt.includes(orderNumber) && /Ready/.test(tt) && tt.includes('Enseigne caisson 3 m'), 'the public tracker page shows the order as Ready, with its item');
  ok(!tt.includes('1250') && !tt.includes('4 464') && !tt.includes(customerName), 'the tracker page reveals no price and no customer name');
  await tracker.screenshot({ path: `${SHOTS}14-tracker.png` });
  await tracker.close();

  // ── 9. Arabic: the same screens, right to left ─────────────────────────────
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const setLanguage = async (name) => {
    await page.evaluate((n) => [...document.querySelectorAll('[role=radiogroup] [role=radio]')].find((b) => b.textContent.trim() === n).click(), name);
    await sleep(400);
  };
  const direction = () => page.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang }));

  await go('#/orders');
  await setLanguage('العربية');
  let d = await direction();
  ok(d.dir === 'rtl' && d.lang === 'ar', 'choosing العربية flips the whole page to right-to-left (dir=rtl, lang=ar)');
  await waitText('من عرض السعر إلى التسليم');
  const sidebarSide = await page.evaluate(() => { const r = document.querySelector('aside').getBoundingClientRect(); return r.left > window.innerWidth / 2; });
  ok(sidebarSide, 'the navigation moves to the right-hand side');
  ok(await noOverflow(), 'no horizontal overflow on the Arabic orders list');
  await shot('15-ar-orders');

  await go('#/');
  await waitText('لوحة القيادة');
  const arDash = await text();
  ok(/\d[\d ]*,\d{2}\s*دج/.test(arDash), 'the dashboard writes amounts as "4 464,29 دج" (Latin digits, dinar sign after the number)');
  ok(/(جانفي|فيفري|مارس|أفريل|ماي|جوان|جويلية|أوت|سبتمبر|أكتوبر|نوفمبر|ديسمبر) \d{4}/.test(arDash), 'the reporting month is named in Arabic');
  ok(await noOverflow(), 'no horizontal overflow on the Arabic dashboard');
  await shot('16-ar-dashboard');

  await go('#/orders');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, orderNumber);
  await page.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(n)).click(), orderNumber);
  await waitText('تتبع الزبون');
  const ordText = await text();
  ok(ordText.includes('الإنتاج') && ordText.includes('الفاتورة') && /4 464,29\s*دج/.test(ordText), 'the order page is Arabic, with the total in dinars');
  const orderNumberLtr = await page.evaluate((n) => [...document.querySelectorAll('bdi[dir=ltr]')].some((el) => el.textContent === n), orderNumber);
  ok(orderNumberLtr, 'the order number stays a left-to-right island inside the Arabic page');
  await shot('17-ar-order');

  await go('#/production');
  await waitText('لوحة الإنتاج');
  ok(await columnHas('COMPLETED', poNumber), 'the board keeps working in Arabic: the card sits in the Completed column');
  ok((await page.evaluate(() => document.querySelector('[data-column=DRAFT]').getBoundingClientRect().left)) > (await page.evaluate(() => document.querySelector('[data-column=COMPLETED]').getBoundingClientRect().left)), 'the first stage (Draft) is on the right, as Arabic reads');
  await shot('18-ar-kanban');

  await go('#/ledger');
  await waitText('قيود اليومية');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, invoiceNumber);
  await page.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(n)).click(), invoiceNumber);
  await page.waitForFunction(() => document.body.innerText.includes('الزبائن'), { timeout: 10000 });
  const arLines = await text();
  ok(arLines.includes('الزبائن') && arLines.includes('مبيعات المنتجات التامة') && arLines.includes('الرسم على القيمة المضافة'), 'ledger accounts 411 / 701 / 44571 carry their Arabic names');
  await shot('19-ar-ledger');

  await go('#/invoices');
  await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 10000 }, invoiceNumber);
  await page.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(n)).click(), invoiceNumber);
  await waitText('الرصيد المستحق');
  ok(/مدفوعة/.test(await text()), 'the invoice status is shown in Arabic (paid)');
  await shot('20-ar-invoice');

  // the choice survives a reload
  await page.reload({ waitUntil: 'networkidle0' });
  d = await direction();
  ok(d.dir === 'rtl' && d.lang === 'ar', 'the language choice is remembered after a reload');

  // the public tracker follows the visitor's browser language, and offers a switch
  const trackerAr = await browser.newPage();
  await trackerAr.setExtraHTTPHeaders({ 'accept-language': 'ar-DZ,ar;q=0.9,en;q=0.5' });
  await trackerAr.goto(trackingUrl, { waitUntil: 'networkidle0' });
  const ta = await trackerAr.evaluate(() => ({ dir: document.documentElement.dir, lang: document.documentElement.lang, text: document.body.innerText, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
  ok(ta.dir === 'rtl' && ta.lang === 'ar' && ta.text.includes('جاهز') && ta.text.includes('مراحل الطلب'), 'the tracker page opens in Arabic for an Arabic browser, with the steps translated');
  ok(!ta.overflow && !ta.text.includes('4 464') && !ta.text.includes(customerName), 'the Arabic tracker still shows no price and no customer name');
  await trackerAr.screenshot({ path: SHOTS + '21-tracker-ar.png' });
  await trackerAr.evaluate(() => [...document.querySelectorAll('.lang button')].find((b) => b.textContent === 'English').click());
  await trackerAr.waitForFunction(() => document.documentElement.lang === 'en', { timeout: 10000 });
  ok(true, "the tracker's language switch works (Arabic → English) without a reload by hand");
  await trackerAr.close();

  // back to English for the rest of the flow
  await setLanguage('English');
  d = await direction();
  ok(d.dir === 'ltr' && d.lang === 'en', 'switching back to English restores left-to-right');

  // ── 10. sign out ─────────────────────────────────────────────────────────────
  await clickButton('Sign out');
  await waitText('Sign in to continue');
  ok(true, 'sign out returns to the login screen');
} catch (err) {
  failures++;
  console.log(`FAIL  unexpected error: ${err.message}`);
  await shot('zz-failure').catch(() => {});
  console.log('page text at failure:\n', (await text().catch(() => '')).slice(0, 600));
} finally {
  const real = consoleErrors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(e));
  ok(real.length === 0, `no unexpected browser console errors${real.length ? `: ${real.slice(0, 3).join(' || ')}` : ''}`);
  await browser.close();
  console.log(failures === 0 ? '\nALL UI CHECKS PASSED' : `\n${failures} UI CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
