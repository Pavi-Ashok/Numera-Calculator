(function () {
  'use strict';

  const { evaluate, format, CalcError } = window.CalcEngine;

  const HISTORY_KEY = 'numera.history';
  const HISTORY_LIMIT = 100;
  const THEME_KEY = 'numera.theme';
  const THEMES = ['system', 'light', 'dark'];
  const ANGLE_NAMES = { deg: 'degrees', rad: 'radians', grad: 'gradians' };
  const ANGLE_MODES = Object.keys(ANGLE_NAMES);

  // Inputs that start with one of these continue from the previous result after "=".
  const CONTINUES_RESULT = ['+', '−', '×', '÷', '^', '²', '³', '⁻¹', '!', '%', 'ʸ√', 'P', 'C', ' mod '];

  // Keys that need a value on both sides; pressing one right after another replaces it.
  const BINARY_INPUTS = [' mod ', 'ʸ√', '+', '−', '×', '÷', '^', 'P', 'C'];

  // Multi-character chunks removed as a unit by backspace (longest first).
  const CHUNKS = [
    'sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹(', 'sin⁻¹(', 'cos⁻¹(', 'tan⁻¹(',
    'sinh(', 'cosh(', 'tanh(', 'log₂(', 'sin(', 'cos(', 'tan(', 'log(', 'abs(',
    'ln(', '10^(', 'e^(', '2^(', '√(', '∛(', ' mod ', 'Ans', 'ʸ√', '⁻¹',
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    expression: $('expression'),
    result: $('result'),
    indAngle: $('ind-angle'),
    indSecond: $('ind-second'),
    indMemory: $('ind-memory'),
    keySecond: $('key-second'),
    keyAngle: $('key-angle'),
    calculator: document.querySelector('.calculator'),
    sciToggle: $('sci-toggle'),
    modeName: $('mode-name'),
    historyToggle: $('history-toggle'),
    menu: $('menu'),
    menuToggle: $('menu-toggle'),
    about: $('about'),
    history: $('history'),
    historyList: $('history-list'),
    historyEmpty: $('history-empty'),
    secondKeys: [...document.querySelectorAll('[data-insert2]')], // keys relabelled by 2nd
  };

  const state = {
    expr: '',
    lastResult: '0', // formatted text of the last "=" result
    ans: 0, // numeric value of the last "=" result
    justEvaluated: false,
    error: null,
    angle: 'deg',
    second: false,
    scientific: false, // scientific keys open only when the Scientific button is pressed
    memory: null,
    history: loadHistory(),
    historyStale: true, // list DOM is rebuilt lazily, only when the drawer opens
  };

  // ---------- persistence ----------

  function loadHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
    } catch {
      /* storage unavailable: history just won't persist */
    }
  }

  // ---------- helpers ----------

  const calc = (expr) => evaluate(expr, { angle: state.angle, ans: state.ans });

  function closeParens(expr) {
    const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
    return open > 0 ? expr + ')'.repeat(open) : expr;
  }

  // Text to insert for a numeric value, bracketed when negative so it composes safely.
  const valueText = (value) => {
    const text = format(value);
    return value < 0 ? `(${text})` : text;
  };

  function startFresh() {
    state.justEvaluated = false;
    state.error = null;
  }

  // ---------- actions ----------

  function insert(text, isValue = false) {
    if (state.justEvaluated || state.error) {
      const continues = !state.error && CONTINUES_RESULT.some((op) => text.startsWith(op));
      state.expr = continues ? valueText(state.ans) : '';
      startFresh();
    }
    // guardInput may rewrite state.expr, so read it only after the call.
    const addition = guardInput(state.expr, text, isValue);
    state.expr += addition;
  }

  // Adjust a key press so the expression stays well formed. May rewrite state.expr
  // (to replace a trailing operator) and returns the text to append.
  function guardInput(expr, text, isValue) {
    const currentNumber = (expr.match(/(?:\d+\.?\d*|\.\d+)(?:E[+\-−]?\d*)?$/) || [''])[0];
    const endsWithDigitOrDot = /[\d.]$/.test(expr);

    if (text === 'rand') {
      text = format(Math.random());
      isValue = true;
    }

    if (text === '.') {
      if (/[.E]/.test(currentNumber)) return ''; // one decimal point per number
      return endsWithDigitOrDot ? '.' : '0.';
    }
    if (text === 'E') {
      // EXP needs a mantissa without an exponent yet: "2E5", not "E5" or "2E5E3".
      return /^[\d.]+$/.test(currentNumber) ? 'E' : '';
    }
    if (isValue && endsWithDigitOrDot) {
      return '×' + text; // recalled values (MR, Rand) don't merge into the typed number
    }
    if (BINARY_INPUTS.includes(text)) {
      const isSign = text === '−' || text === '+';
      const trailingOp = (s) => BINARY_INPUTS.find((op) => s.endsWith(op));
      const trailing = trailingOp(expr);
      // Allow a negative sign after ×, ÷, ^ etc. ("2×−3").
      if (text === '−' && trailing && trailing !== '−' && trailing !== '+') return text;
      // Otherwise a new operator replaces any operators already at the end.
      let trimmed = expr;
      while (trailingOp(trimmed)) trimmed = trimmed.slice(0, -trailingOp(trimmed).length);
      state.expr = trimmed;
      if (!trimmed) return isSign ? text : '0' + text;
      if (trimmed.endsWith('(') && !isSign) return '';
    }
    return text;
  }

  function backspace() {
    if (state.justEvaluated || state.error) {
      startFresh();
      return;
    }
    const chunk = CHUNKS.find((c) => state.expr.endsWith(c));
    state.expr = state.expr.slice(0, -(chunk ? chunk.length : 1));
  }

  function clearAll() {
    state.expr = '';
    startFresh();
  }

  function negate() {
    if (state.justEvaluated) {
      state.expr = valueText(state.ans);
      startFresh();
    }
    const number = /(\d+\.?\d*(?:E[+\-−]?\d+)?|\.\d+)$/;
    const negated = /\(-(\d+\.?\d*(?:E[+\-−]?\d+)?|\.\d+)\)?$/;
    if (negated.test(state.expr)) {
      state.expr = state.expr.replace(negated, '$1');
    } else if (number.test(state.expr)) {
      state.expr = state.expr.replace(number, '(-$1)');
    } else {
      state.expr += '(-';
    }
  }

  function equals() {
    if (state.justEvaluated || state.error || !state.expr.trim()) return;
    const expr = closeParens(state.expr);
    try {
      const value = calc(expr);
      const result = format(value);
      state.ans = value;
      state.lastResult = result;
      state.expr = expr;
      state.justEvaluated = true;
      addHistory(expr, result);
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      state.error = err.message;
    }
  }

  // Value used by the memory keys: last result, or the current expression if it evaluates.
  function currentValue() {
    if (state.justEvaluated) return state.ans;
    if (!state.expr.trim()) return state.ans;
    try {
      return calc(closeParens(state.expr));
    } catch {
      return null;
    }
  }

  const actions = {
    clear: clearAll,
    back: backspace,
    negate,
    equals,
    second() {
      state.second = !state.second;
    },
    angle() {
      state.angle = ANGLE_MODES[(ANGLE_MODES.indexOf(state.angle) + 1) % ANGLE_MODES.length];
    },
    mc() {
      state.memory = null;
    },
    mr() {
      if (state.memory !== null) insert(valueText(state.memory), true);
    },
    ms() {
      const v = currentValue();
      if (v !== null) state.memory = v;
    },
    mplus() {
      const v = currentValue();
      if (v !== null) state.memory = (state.memory || 0) + v;
    },
    mminus() {
      const v = currentValue();
      if (v !== null) state.memory = (state.memory || 0) - v;
    },
  };

  function setScientific(on) {
    state.scientific = on;
    if (!on) state.second = false;
    window.calcWindow?.setScientific(on);
    render();
  }

  // ---------- theme ----------

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function loadThemeChoice() {
    try {
      const choice = localStorage.getItem(THEME_KEY);
      return THEMES.includes(choice) ? choice : 'system';
    } catch {
      return 'system';
    }
  }

  let themeChoice = loadThemeChoice();

  function applyTheme() {
    const dark = themeChoice === 'dark' || (themeChoice === 'system' && systemDark.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-choice]').forEach((item) => {
      item.setAttribute('aria-checked', String(item.dataset.themeChoice === themeChoice));
    });
  }

  function setTheme(choice) {
    themeChoice = THEMES.includes(choice) ? choice : 'system';
    try {
      localStorage.setItem(THEME_KEY, themeChoice);
    } catch {
      /* storage unavailable: choice lasts for this session */
    }
    window.calcWindow?.setTheme(themeChoice);
    applyTheme();
  }

  systemDark.addEventListener('change', applyTheme);

  // ---------- history ----------

  function addHistory(expr, result) {
    state.history.unshift({ expr, result });
    state.history.length = Math.min(state.history.length, HISTORY_LIMIT);
    state.historyStale = true;
    saveHistory();
  }

  function renderHistory() {
    state.historyStale = false;
    els.historyList.replaceChildren(
      ...state.history.map((item, index) => {
        const li = document.createElement('li');
        li.dataset.index = String(index);
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', `${item.expr} equals ${item.result}`);
        const e = document.createElement('div');
        e.className = 'history-expr';
        e.textContent = `${item.expr} =`;
        const r = document.createElement('div');
        r.className = 'history-result';
        r.textContent = item.result;
        li.append(e, r);
        return li;
      })
    );
    els.historyEmpty.hidden = state.history.length > 0;
  }

  function isHistoryOpen() {
    return els.history.classList.contains('open');
  }

  function setHistoryOpen(open) {
    if (open && state.historyStale) renderHistory();
    els.history.classList.toggle('open', open);
    els.history.inert = !open; // also hides the closed drawer from screen readers
    els.historyToggle.setAttribute('aria-expanded', String(open));
    if (open) (els.historyList.querySelector('li') || $('history-close')).focus();
  }

  // ---------- settings menu & about ----------

  function isMenuOpen() {
    return !els.menu.hidden;
  }

  function setMenuOpen(open, { focusToggle = false } = {}) {
    els.menu.hidden = !open;
    els.menuToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      const checked = els.menu.querySelector('[aria-checked="true"]') || els.menu.querySelector('button');
      checked.focus();
    } else if (focusToggle) {
      els.menuToggle.focus();
    }
  }

  async function openAbout() {
    setMenuOpen(false);
    const info = await (window.calcWindow?.getInfo?.() ?? Promise.resolve(null)).catch(() => null);
    if (info) {
      $('about-version').textContent = `Version ${info.version}`;
      $('about-copyright').textContent = info.copyright;
    }
    els.about.showModal();
  }

  // ---------- rendering ----------

  let renderedSecond = false; // 2nd state the key labels currently show

  function render() {
    els.calculator.classList.toggle('scientific', state.scientific);
    els.sciToggle.setAttribute('aria-pressed', String(state.scientific));
    els.modeName.textContent = state.scientific ? 'Scientific' : 'Standard';

    const angleLabel = state.angle.toUpperCase();
    els.indAngle.textContent = angleLabel;
    els.keyAngle.textContent = angleLabel;
    els.keyAngle.setAttribute('aria-label', `Angle unit: ${ANGLE_NAMES[state.angle]}`);
    els.indSecond.hidden = !state.second;
    els.keySecond.setAttribute('aria-pressed', String(state.second));
    els.indMemory.hidden = state.memory === null;

    if (renderedSecond !== state.second) {
      renderedSecond = state.second;
      for (const btn of els.secondKeys) {
        btn.textContent = state.second ? btn.dataset.label2 : btn.dataset.label || btn.dataset.insert;
        btn.setAttribute('aria-label', state.second ? btn.dataset.aria2 : btn.dataset.aria1);
      }
    }

    let resultText;
    let preview = false;
    if (state.error) {
      els.expression.textContent = state.expr;
      resultText = state.error;
    } else if (state.justEvaluated) {
      els.expression.textContent = `${state.expr} =`;
      resultText = state.lastResult;
    } else {
      els.expression.textContent = state.expr;
      resultText = livePreview();
      preview = state.expr !== '';
    }

    els.result.textContent = resultText;
    els.result.classList.toggle('error', Boolean(state.error));
    els.result.classList.toggle('preview', preview);
    els.result.classList.toggle('long', resultText.length > 12 && resultText.length <= 18);
    els.result.classList.toggle('longer', resultText.length > 18);
  }

  function livePreview() {
    if (!state.expr.trim()) return '0';
    try {
      return format(calc(closeParens(state.expr)));
    } catch {
      return state.expr ? '…' : '0';
    }
  }

  // ---------- input wiring ----------

  function press(button) {
    if (button.dataset.action) {
      actions[button.dataset.action]();
    } else if (button.dataset.insert !== undefined) {
      const text = state.second && button.dataset.insert2 ? button.dataset.insert2 : button.dataset.insert;
      insert(text);
      // 2nd is a one-shot modifier for function keys.
      if (state.second && button.dataset.insert2) state.second = false;
    }
    render();
  }

  document.querySelectorAll('.key').forEach((button) => {
    button.addEventListener('click', () => press(button));
  });

  // Remember each key's primary accessible name so 2nd can swap it back.
  for (const btn of els.secondKeys) btn.dataset.aria1 = btn.getAttribute('aria-label');

  // Keyboard: map each key name to the on-screen button that declares it.
  const keyMap = new Map();
  document.querySelectorAll('[data-key]').forEach((button) => {
    button.dataset.key.split(' ').forEach((k) => keyMap.set(k, button));
  });

  function flash(button) {
    button.classList.add('pressed');
    setTimeout(() => button.classList.remove('pressed'), 120);
  }

  function moveMenuFocus(step) {
    const items = [...els.menu.querySelectorAll('.flyout-item')];
    const index = items.indexOf(document.activeElement);
    items[(index + step + items.length) % items.length].focus();
  }

  document.addEventListener('keydown', (event) => {
    // The About dialog handles its own keys (Esc / Enter close it).
    if (els.about.open) return;

    if (isMenuOpen()) {
      if (event.key === 'Escape') setMenuOpen(false, { focusToggle: true });
      else if (event.key === 'ArrowDown') moveMenuFocus(1);
      else if (event.key === 'ArrowUp') moveMenuFocus(-1);
      else if (event.key === 'Tab') setMenuOpen(false);
      else return;
      if (event.key !== 'Tab') event.preventDefault();
      return;
    }

    if (event.key === 'Escape' && isHistoryOpen()) {
      setHistoryOpen(false);
      els.historyToggle.focus();
      event.preventDefault();
      return;
    }

    // Inside the history drawer, Enter/Space act on the focused entry, not the keypad.
    if (event.target.closest?.('.history')) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('li')) {
        event.target.click();
        event.preventDefault();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (event.ctrlKey && event.key.toLowerCase() === 'c' && !window.getSelection().toString()) {
        navigator.clipboard?.writeText(els.result.textContent).catch(() => {});
        event.preventDefault();
      }
      return;
    }

    const button = keyMap.get(event.key);
    // Shortcuts for hidden scientific keys are ignored until the keys are shown.
    if (!button || (button.classList.contains('sci') && !state.scientific)) return;
    event.preventDefault();
    flash(button);
    button.click();
  });

  els.sciToggle.addEventListener('click', () => setScientific(!state.scientific));

  // History drawer
  els.historyToggle.addEventListener('click', () => setHistoryOpen(!isHistoryOpen()));
  $('history-close').addEventListener('click', () => {
    setHistoryOpen(false);
    els.historyToggle.focus();
  });
  $('history-clear').addEventListener('click', () => {
    state.history = [];
    saveHistory();
    renderHistory();
  });
  els.historyList.addEventListener('click', (event) => {
    const li = event.target.closest('li');
    if (!li) return;
    const item = state.history[Number(li.dataset.index)];
    if (!item) return;
    state.expr = item.expr;
    startFresh();
    setHistoryOpen(false);
    render();
  });

  // Settings menu
  els.menuToggle.addEventListener('click', () => setMenuOpen(!isMenuOpen()));
  els.menu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-theme-choice]');
    if (item) {
      setTheme(item.dataset.themeChoice);
      setMenuOpen(false, { focusToggle: true });
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (isMenuOpen() && !event.target.closest('#menu, #menu-toggle')) setMenuOpen(false);
  });
  $('about-open').addEventListener('click', openAbout);

  applyTheme();
  window.calcWindow?.setTheme(themeChoice);
  render();
})();
