/*
 * End-to-end UI test: drives the real calculator page in a hidden Electron window
 * by clicking keys and typing, then checks what the display shows.
 * Run with: npm run test:ui
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

// Fresh profile every run, so saved theme/history from earlier runs can't leak in.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'numera-ui-test-'));
app.setPath('userData', profile);
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
const sizeRequests = [];
ipcMain.on('calc:set-scientific', (_event, on) => sizeRequests.push(on));
const themeRequests = [];
ipcMain.on('calc:set-theme', (_event, choice) => themeRequests.push(choice));
ipcMain.handle('calc:get-info', () => ({ name: 'Numera Calculator', version: '9.8.7', copyright: '© test' }));

// Each step: [description, page script, expected { expr?, result? } or a custom check].
// In page scripts: k('label') clicks a key, t('key') types a keyboard key, s() toggles Scientific.
const SCENARIOS = [
  ['starts in standard mode with scientific keys hidden',
    `null`, () => `isHidden('sin') && !isHidden('7') && sciText() === 'false' && modeName() === 'Standard'`],
  ['scientific keys hidden -> keyboard shortcut "s" is ignored',
    `t('s'); t('2')`, { expr: '2' }],
  ['Scientific button opens the scientific keys',
    `k('AC'); s()`, () => `!isHidden('sin') && !isHidden('nCr') && sciText() === 'true' && modeName() === 'Scientific'`],
  ['F2 closes them again, and 2nd is reset',
    `k('2nd'); t('F2')`, () => `isHidden('sin') && document.getElementById('key-second').getAttribute('aria-pressed') === 'false'`],
  ['window asked to grow then shrink', `s(); s(); s()`, () => `true`],

  ['basic: 2+3×4', `k('AC'); keys('2+3×4='); `, { expr: '2+3×4 =', result: '14' }],
  ['floating point: 0.1+0.2−0.3', `k('AC'); keys('.1+.2−.3=')`, { expr: '0.1+0.2−0.3 =', result: '0' }],
  ['percent: 200+10%', `k('AC'); keys('200+10%=')`, { result: '220' }],
  ['second decimal point ignored', `k('AC'); keys('1.2.3')`, { expr: '1.23' }],
  ['"." on empty input becomes 0.', `k('AC'); keys('.5')`, { expr: '0.5' }],
  ['operator replaces operator: 5+×2', `k('AC'); keys('5+×2=')`, { expr: '5×2 =', result: '10' }],
  ['minus after × makes a negative: 2×−3', `k('AC'); keys('2×−3=')`, { result: '-6' }],
  ['× − + collapses to +', `k('AC'); keys('9×−+1=')`, { expr: '9+1 =', result: '10' }],
  ['leading × starts from 0', `k('AC'); keys('×5')`, { expr: '0×5' }],
  ['leading − is a negative number', `k('AC'); keys('−5+2=')`, { result: '-3' }],
  ['EXP: 2E−5', `k('AC'); keys('2'); k('EXP'); keys('−5=')`, { result: '0.00002' }],
  ['EXP with nothing before it is ignored', `k('AC'); k('EXP'); keys('3')`, { expr: '3' }],
  ['EXP twice is ignored', `k('AC'); keys('2'); k('EXP'); keys('3'); k('EXP'); keys('4')`, { expr: '2E34' }],
  ['continue from result with operator', `k('AC'); keys('2+3=×2=')`, { expr: '5×2 =', result: '10' }],
  ['digit after result starts a new calculation', `keys('7')`, { expr: '7' }],
  ['negative result continues safely: −5 then x²',
    `k('AC'); keys('2−7='); k('x²'); keys('=')`, { expr: '(-5)² =', result: '25' }],
  ['pressing = repeatedly does nothing', `k('AC'); keys('4+4===')`, { expr: '4+4 =', result: '8' }],
  ['± toggles sign and back', `k('AC'); keys('12'); k('±')`, { expr: '(-12)' }],
  ['± again removes the sign', `k('±')`, { expr: '12' }],
  ['missing ) is auto-closed', `k('AC'); keys('(2+3='); `, { expr: '(2+3) =', result: '5' }],
  ['implicit multiplication: 2(3+4)', `k('AC'); keys('2(3+4)=')`, { result: '14' }],
  ['divide by zero shows Math Error', `k('AC'); keys('1÷0=')`, { expr: '1÷0', result: 'Math Error' }],
  ['digit after error starts fresh', `keys('8')`, { expr: '8' }],
  ['backspace after error returns to editing', `k('AC'); keys('5÷0='); k('⌫')`, { expr: '5÷0' }],
  ['incomplete input shows … not an error', `k('AC'); keys('5+')`, { expr: '5+', result: '…' }],
  ['syntax error on =', `k('AC'); keys('5+=')`, { result: 'Syntax Error' }],

  ['memory: MS, then MR after digits multiplies',
    `k('AC'); keys('3='); k('MS'); k('AC'); keys('5'); k('MR'); keys('=')`, { expr: '5×3 =', result: '15' }],
  ['memory: M+ and M−', `k('AC'); keys('10'); k('M+'); k('AC'); keys('4'); k('M−'); k('AC'); k('MR'); keys('=')`,
    { result: '9' }],
  ['memory: MC clears the M badge', `k('MC')`, () => `document.getElementById('ind-memory').hidden`],

  ['scientific keys are still open', `null`, () => `!isHidden('sin')`],
  ['scientific: sin(30) in DEG', `k('AC'); k('sin'); keys('30=')`, { expr: 'sin(30) =', result: '0.5' }],
  ['scientific: 2nd is one-shot (sin⁻¹ then sin)',
    `k('AC'); k('2nd'); k('sin'); keys('1)'); k('sin'); keys('30=')`, { expr: 'sin⁻¹(1)sin(30) =', result: '45' }],
  ['scientific: RAD mode sin(π÷2)', `k('AC'); k('DEG'); k('sin'); k('π'); keys('÷2=')`, { result: '1' }],
  ['scientific: GRAD mode cos(200)', `k('AC'); k('RAD'); k('cos'); keys('200=')`, { result: '-1' }],
  ['scientific: back to DEG; tan(90) is Math Error', `k('AC'); k('GRAD'); k('tan'); keys('90=')`, { result: 'Math Error' }],
  ['scientific: backspace removes sin⁻¹( as one unit', `k('AC'); keys('2+'); k('2nd'); k('sin'); k('⌫')`, { expr: '2+' }],
  ['scientific: 5nCr2', `k('AC'); keys('5'); k('nCr'); keys('2=')`, { result: '10' }],
  ['scientific: 69!', `k('AC'); keys('69'); k('n!'); keys('=')`, { result: '1.71122452428E98' }],
  ['scientific: 171! overflows to Math Error', `k('AC'); keys('171'); k('n!'); keys('=')`, { result: 'Math Error' }],
  ['scientific: ∛(−27) via 2nd', `k('AC'); k('2nd'); k('√'); keys('−27=')`, { result: '-3' }],
  ['scientific: 27 ʸ√ 3', `k('AC'); keys('27'); k('ʸ√x'); keys('3=')`, { result: '3' }],
  ['scientific: Ans reuses last result', `k('AC'); keys('6×7='); k('AC'); k('Ans'); keys('+1=')`, { result: '43' }],
  ['scientific: Rand inserts a number in [0,1)',
    `k('AC'); k('2nd'); k('Rand'); keys('=')`, () => `(() => { const v = +read().result; return v >= 0 && v < 1; })()`],
  ['scientific: 10ˣ of log round-trips', `k('AC'); k('2nd'); k('log'); k('log'); keys('7=')`, { result: '7' }],

  ['keyboard: typed expression with Enter', `k('AC'); ['1','2','*','(','3','-','1',')','Enter'].forEach(t)`,
    { expr: '12×(3−1) =', result: '24' }],
  ['keyboard: Backspace and Escape', `['9','8','Backspace'].forEach(t)`, { expr: '9' }],
  ['keyboard: Escape clears', `t('Escape')`, { expr: '', result: '0' }],
  ['keyboard: s/r shortcuts work when scientific is open', `['r','8','1','Enter'].forEach(t)`, { result: '9' }],

  ['long result gets smaller font', `k('AC'); keys('123456789×987654321=')`,
    () => `document.getElementById('result').classList.contains('long')`],
  ['history: newest entry restores on click', `k('AC'); document.getElementById('history-toggle').click();
      document.querySelector('#history-list li').click()`, { expr: '123456789×987654321' }],
  ['history: keyboard Enter on a focused entry restores it', `k('AC'); keys('6÷3='); k('AC');
      document.getElementById('history-toggle').click();
      const li = document.querySelector('#history-list li'); li.focus();
      li.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
    () => `read().expr === '6÷3' && !document.getElementById('history').classList.contains('open')`],
  ['history: Escape closes the drawer without clearing', `k('AC'); keys('42'); document.getElementById('history-toggle').click(); t('Escape')`,
    () => `read().expr === '42' && document.getElementById('history').inert`],

  // ---------- themes & branding ----------
  ['theme: menu opens with the current choice checked', `document.getElementById('menu-toggle').click()`,
    () => `!document.getElementById('menu').hidden &&
      document.querySelector('[data-theme-choice="system"]').getAttribute('aria-checked') === 'true'`],
  ['theme: Escape closes the menu without clearing the display', `t('Escape')`,
    () => `document.getElementById('menu').hidden && read().expr === '42'`],
  ['theme: choose Dark', `document.getElementById('menu-toggle').click();
      document.querySelector('[data-theme-choice="dark"]').click()`,
    () => `document.documentElement.dataset.theme === 'dark' && localStorage.getItem('numera.theme') === 'dark' &&
      getComputedStyle(document.body).backgroundColor === 'rgb(32, 32, 32)' && document.getElementById('menu').hidden`],
  ['theme: = key uses the brand accent in dark mode', `null`,
    () => `getComputedStyle(document.querySelector('.key.eq')).getPropertyValue('--accent').trim() === '#479ef5'`],
  ['theme: choose Light', `document.getElementById('menu-toggle').click();
      document.querySelector('[data-theme-choice="light"]').click()`,
    () => `later(() => document.documentElement.dataset.theme === 'light' &&
      getComputedStyle(document.body).backgroundColor === 'rgb(243, 243, 243)' &&
      getComputedStyle(document.querySelector('.key.eq')).getPropertyValue('--accent').trim() === '#0f6cbd')`],
  ['theme: choose System follows Windows', `document.getElementById('menu-toggle').click();
      document.querySelector('[data-theme-choice="system"]').click()`,
    () => `document.documentElement.dataset.theme ===
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')`],
  ['theme: arrow keys move through the menu', `document.getElementById('menu-toggle').click(); t('ArrowDown')`,
    () => `document.activeElement.dataset.themeChoice === 'light'`],
  ['theme: close menu', `t('Escape')`, () => `document.getElementById('menu').hidden`],
  ['about: shows app name and version from the app', `document.getElementById('about-open').click()`,
    () => `later(() => document.getElementById('about').open &&
      document.getElementById('about-version').textContent === 'Version 9.8.7' &&
      document.getElementById('about-title').textContent === 'Numera Calculator')`],
  ['about: keypad ignores typing while the dialog is open', `t('9')`, { expr: '42' }],
  ['about: OK closes it', `document.querySelector('#about button').click()`,
    () => `!document.getElementById('about').open`],
  ['branding: window title and logo', `null`,
    () => `document.title === 'Numera Calculator' && document.querySelector('.brand-name').textContent === 'Numera' &&
      document.querySelector('.brand-logo').naturalWidth > 0`],

  // ---------- accessibility ----------
  ['a11y: every non-digit key has an accessible name', `null`,
    () => `[...document.querySelectorAll('.key')].every((b) =>
      /^\\d$/.test(b.textContent.trim()) || (b.getAttribute('aria-label') || '').length >= 2)`],
  ['a11y: keys are reachable with Tab', `null`,
    () => `[...document.querySelectorAll('.key, #sci-toggle, #history-toggle, #menu-toggle')].every((b) => b.tabIndex === 0)`],
  ['a11y: 2nd swaps accessible names and back', `k('AC'); k('2nd')`,
    () => `(() => { const sin = document.querySelector('[data-label="sin"]');
      const swapped = sin.getAttribute('aria-label') === 'Inverse sine' &&
        document.getElementById('key-second').getAttribute('aria-pressed') === 'true';
      k('2nd'); return swapped && sin.getAttribute('aria-label') === 'Sine'; })()`],
  ['a11y: angle key announces the unit', `k('DEG')`,
    () => `(() => { const ok = document.getElementById('key-angle').getAttribute('aria-label') === 'Angle unit: radians';
      k('RAD'); k('GRAD'); return ok; })()`],
  ['a11y: result is a live region', `null`,
    () => `document.getElementById('result').getAttribute('aria-live') === 'polite'`],
];

const PAGE_HELPERS = `
  const keysEl = () => [...document.querySelectorAll('.key')];
  window.k = (label) => {
    const b = keysEl().find((x) => x.dataset.label === label || x.textContent.trim() === label);
    if (!b) throw new Error('no key ' + label);
    b.click();
  };
  window.keys = (text) => [...text].forEach(k);
  window.t = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  window.s = () => document.getElementById('sci-toggle').click();
  window.sciText = () => document.getElementById('sci-toggle').getAttribute('aria-pressed');
  window.modeName = () => document.getElementById('mode-name').textContent;
  window.later = (fn, ms = 150) => new Promise((r) => setTimeout(() => r(fn()), ms));
  window.isHidden = (label) => {
    const b = keysEl().find((x) => x.dataset.label === label || x.textContent.trim() === label);
    return b.offsetParent === null;
  };
  window.read = () => ({
    expr: document.getElementById('expression').textContent,
    result: document.getElementById('result').textContent,
  });
  try { localStorage.clear(); } catch {}
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 440,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(root, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const consoleErrors = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') consoleErrors.push(e.message);
  });
  await win.loadFile(path.join(root, 'src', 'index.html'));
  const run = (js) => win.webContents.executeJavaScript(js);
  await run(PAGE_HELPERS);

  let failures = 0;
  for (const [name, script, expected] of SCENARIOS) {
    let ok;
    let detail = '';
    try {
      await run(`(() => { ${script}; })()`);
      if (typeof expected === 'function') {
        ok = await run(expected());
        detail = JSON.stringify(await run('read()'));
      } else {
        const actual = await run('read()');
        ok = Object.entries(expected).every(([key, value]) => actual[key] === value);
        detail = `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`;
      }
    } catch (err) {
      ok = false;
      detail = err.message;
    }
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '\n      ' + detail}`);
  }

  const resizeOk = JSON.stringify(sizeRequests) === JSON.stringify([true, false, true, false, true]);
  if (!resizeOk) failures++;
  console.log(`${resizeOk ? 'PASS' : 'FAIL'}  window resize requests sent: ${JSON.stringify(sizeRequests)}`);
  // Page reports its theme on load, then once per menu choice: dark, light, system.
  const themeOk = JSON.stringify(themeRequests) === JSON.stringify(['system', 'dark', 'light', 'system']);
  if (!themeOk) failures++;
  console.log(`${themeOk ? 'PASS' : 'FAIL'}  theme sync sent to window: ${JSON.stringify(themeRequests)}`);
  if (consoleErrors.length) {
    failures++;
    console.log('FAIL  console errors:', consoleErrors);
  }

  console.log(`\n${SCENARIOS.length + 2 - failures} passed, ${failures} failed`);
  app.exit(failures ? 1 : 0);
});
