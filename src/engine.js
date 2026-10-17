/*
 * Calculation engine: tokenizer + recursive-descent parser/evaluator.
 * Never uses eval(). Works both in the browser (window.CalcEngine) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  class CalcError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CalcError';
    }
  }

  const SYNTAX = 'Syntax Error';
  const MATH = 'Math Error';
  const syntaxError = () => new CalcError(SYNTAX);
  const mathError = () => new CalcError(MATH);

  // ---------- helpers ----------

  const clean = (x) => (Math.abs(x) < 1e-15 ? 0 : x);

  // Degrees and grads are reduced to one turn first (exact), so huge angles keep precision.
  function toRad(x, mode) {
    if (mode === 'deg') return ((x % 360) * Math.PI) / 180;
    if (mode === 'grad') return ((x % 400) * Math.PI) / 200;
    return x;
  }

  function fromRad(x, mode) {
    if (mode === 'deg') return (x * 180) / Math.PI;
    if (mode === 'grad') return (x * 200) / Math.PI;
    return x;
  }

  // Size of a right angle in the given mode, or null for radians.
  const quarterTurn = (mode) => (mode === 'deg' ? 90 : mode === 'grad' ? 100 : null);

  // For exact multiples of 90° (or 100 grad) return the quadrant index 0..3, else null.
  function exactQuadrant(x, mode) {
    const q = quarterTurn(mode);
    if (q === null || x % q !== 0) return null;
    return (((x / q) % 4) + 4) % 4;
  }

  function sin(x, mode) {
    const k = exactQuadrant(x, mode);
    if (k !== null) return [0, 1, 0, -1][k];
    return clean(Math.sin(toRad(x, mode)));
  }

  function cos(x, mode) {
    const k = exactQuadrant(x, mode);
    if (k !== null) return [1, 0, -1, 0][k];
    return clean(Math.cos(toRad(x, mode)));
  }

  function tan(x, mode) {
    const k = exactQuadrant(x, mode);
    if (k !== null) {
      if (k % 2 === 1) throw mathError();
      return 0;
    }
    return clean(Math.tan(toRad(x, mode)));
  }

  function requireDomain(ok) {
    if (!ok) throw mathError();
  }

  // Lanczos approximation of the gamma function.
  const LANCZOS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let x = LANCZOS[0];
    for (let i = 1; i < 9; i++) x += LANCZOS[i] / (z + i);
    const t = z + 7.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }

  function factorial(n) {
    if (Number.isInteger(n)) {
      requireDomain(n >= 0);
      if (n > 170) throw mathError();
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    }
    return gamma(n + 1);
  }

  function requireCombinatoric(n, r) {
    requireDomain(Number.isInteger(n) && Number.isInteger(r) && n >= 0 && r >= 0 && r <= n);
  }

  function permutations(n, r) {
    requireCombinatoric(n, r);
    let result = 1;
    for (let i = n - r + 1; i <= n; i++) result *= i;
    return result;
  }

  function combinations(n, r) {
    requireCombinatoric(n, r);
    r = Math.min(r, n - r);
    let result = 1;
    for (let i = 1; i <= r; i++) result = (result * (n - r + i)) / i;
    return Math.round(result);
  }

  function nthRoot(x, n) {
    requireDomain(n !== 0);
    if (x < 0) {
      requireDomain(Number.isInteger(n) && Math.abs(n) % 2 === 1);
      return -Math.pow(-x, 1 / n);
    }
    return Math.pow(x, 1 / n);
  }

  // ---------- operator tables ----------

  // Prefix functions. Second argument is the angle mode.
  const FUNCTIONS = {
    'sin⁻¹': (x, m) => (requireDomain(x >= -1 && x <= 1), fromRad(Math.asin(x), m)),
    'cos⁻¹': (x, m) => (requireDomain(x >= -1 && x <= 1), fromRad(Math.acos(x), m)),
    'tan⁻¹': (x, m) => fromRad(Math.atan(x), m),
    'sinh⁻¹': (x) => Math.asinh(x),
    'cosh⁻¹': (x) => (requireDomain(x >= 1), Math.acosh(x)),
    'tanh⁻¹': (x) => (requireDomain(x > -1 && x < 1), Math.atanh(x)),
    sinh: (x) => Math.sinh(x),
    cosh: (x) => Math.cosh(x),
    tanh: (x) => Math.tanh(x),
    sin,
    cos,
    tan,
    'log₂': (x) => (requireDomain(x > 0), Math.log2(x)),
    log: (x) => (requireDomain(x > 0), Math.log10(x)),
    ln: (x) => (requireDomain(x > 0), Math.log(x)),
    '√': (x) => (requireDomain(x >= 0), Math.sqrt(x)),
    '∛': (x) => Math.cbrt(x),
    abs: (x) => Math.abs(x),
  };

  // Postfix operators applied to the value on their left.
  const POSTFIX = {
    '!': factorial,
    '%': (x) => x / 100,
    '²': (x) => x * x,
    '³': (x) => x * x * x,
    '⁻¹': (x) => (requireDomain(x !== 0), 1 / x),
  };

  // Addition/subtraction that cancels to floating point noise is exactly zero (0.1+0.2−0.3 = 0).
  function cancel(r, a, b) {
    return Math.abs(r) < 1e-12 * Math.max(Math.abs(a), Math.abs(b)) ? 0 : r;
  }

  // Real-valued power: a negative base with a 1/odd exponent is an odd root, (−8)^(1/3) = −2.
  function power(a, b) {
    if (a < 0 && !Number.isInteger(b)) {
      const n = Math.round(1 / b);
      if (Math.abs(1 / b - n) < 1e-9 && Math.abs(n) % 2 === 1) return -Math.pow(-a, b);
    }
    return Math.pow(a, b);
  }

  // Binary operators (normalised names).
  const BINARY = {
    '+': (a, b) => cancel(a + b, a, b),
    '-': (a, b) => cancel(a - b, a, b),
    '*': (a, b) => a * b,
    '/': (a, b) => (requireDomain(b !== 0), a / b),
    mod: (a, b) => (requireDomain(b !== 0), a % b),
    '^': power,
    'ʸ√': nthRoot,
    P: permutations,
    C: combinations,
  };

  // Symbol aliases accepted in input -> normalised binary operator name.
  const BINARY_SYMBOLS = {
    '+': '+',
    '-': '-',
    '−': '-',
    '*': '*',
    '×': '*',
    '/': '/',
    '÷': '/',
    '^': '^',
    mod: 'mod',
    'ʸ√': 'ʸ√',
    P: 'P',
    C: 'C',
  };

  const CONSTANTS = { 'π': Math.PI, e: Math.E };

  // Everything matched by literal text, longest first so "sinh⁻¹" wins over "sinh" and "sin".
  const WORDS = [
    ...Object.keys(FUNCTIONS).map((w) => ({ text: w, type: 'func' })),
    ...Object.keys(POSTFIX).map((w) => ({ text: w, type: 'post' })),
    ...Object.keys(BINARY_SYMBOLS).map((w) => ({ text: w, type: 'op' })),
    ...Object.keys(CONSTANTS).map((w) => ({ text: w, type: 'const' })),
    { text: 'Ans', type: 'ans' },
    { text: '(', type: '(' },
    { text: ')', type: ')' },
  ].sort((a, b) => b.text.length - a.text.length);

  const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:E[+\-−]?\d+)?/;

  // ---------- tokenizer ----------

  function tokenize(input, ctx) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      const rest = input.slice(i);
      const num = NUMBER_RE.exec(rest);
      if (num) {
        // Two literal numbers back to back ("1.2.3", "2..5") are a typo, not a multiplication.
        const prev = tokens[tokens.length - 1];
        if (prev && prev.literal) throw syntaxError();
        const value = parseFloat(num[0].replace('E', 'e').replace('−', '-'));
        tokens.push({ type: 'num', value, literal: true });
        i += num[0].length;
        continue;
      }
      const word = WORDS.find((w) => rest.startsWith(w.text));
      if (!word) throw syntaxError();
      i += word.text.length;
      switch (word.type) {
        case 'func':
          tokens.push({ type: 'func', name: word.text });
          break;
        case 'post':
          tokens.push({ type: 'post', value: word.text });
          break;
        case 'op':
          tokens.push({ type: 'op', value: BINARY_SYMBOLS[word.text] });
          break;
        case 'const':
          tokens.push({ type: 'num', value: CONSTANTS[word.text] });
          break;
        case 'ans':
          tokens.push({ type: 'num', value: ctx.ans });
          break;
        default:
          tokens.push({ type: word.type });
      }
    }
    return tokens;
  }

  // ---------- parser / evaluator ----------
  //
  // expr    := term (('+' | '-') term)*
  // term    := unary (('*' | '/' | 'mod') unary | <implicit ×> unary)*
  // unary   := ('-' | '+') unary | power
  // power   := postfix (('^' | 'ʸ√' | 'P' | 'C') unary)?      (right-associative)
  // postfix := primary ('!' | '%' | '²' | '³' | '⁻¹')*
  // primary := number | '(' expr ')'? | func ( '(' expr ')'? | postfix )
  //
  // Missing closing parentheses at the end of input are tolerated.

  function evaluateTokens(tokens, ctx) {
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (t, ...values) => t !== undefined && t.type === 'op' && values.includes(t.value);
    const startsPrimary = (t) =>
      t !== undefined && (t.type === 'num' || t.type === 'func' || t.type === '(');

    function expr() {
      let value = term();
      while (isOp(peek(), '+', '-')) {
        const op = tokens[pos++].value;
        const start = pos;
        let rhs = term();
        // "a + b%" adds b percent of a (200+10% = 220), like a desktop calculator.
        const isPercentOfLeft =
          pos - start === 2 && tokens[start].type === 'num' && tokens[start + 1].value === '%';
        if (isPercentOfLeft) rhs *= value;
        value = BINARY[op](value, rhs);
      }
      return value;
    }

    function term() {
      let value = unary();
      for (;;) {
        const t = peek();
        if (isOp(t, '*', '/', 'mod')) {
          pos++;
          value = BINARY[t.value](value, unary());
        } else if (startsPrimary(t)) {
          value = value * unary();
        } else {
          return value;
        }
      }
    }

    function unary() {
      if (isOp(peek(), '-')) {
        pos++;
        return -unary();
      }
      if (isOp(peek(), '+')) {
        pos++;
        return unary();
      }
      return power();
    }

    function power() {
      const base = postfix();
      const t = peek();
      if (isOp(t, '^', 'ʸ√', 'P', 'C')) {
        pos++;
        return BINARY[t.value](base, unary());
      }
      return base;
    }

    function postfix() {
      let value = primary();
      while (peek() !== undefined && peek().type === 'post') {
        value = POSTFIX[tokens[pos++].value](value);
      }
      return value;
    }

    function group() {
      pos++; // '('
      const value = expr();
      const t = peek();
      if (t === undefined) return value; // auto-close at end of input
      if (t.type !== ')') throw syntaxError();
      pos++;
      return value;
    }

    function primary() {
      const t = peek();
      if (t === undefined) throw syntaxError();
      if (t.type === 'num') {
        pos++;
        return t.value;
      }
      if (t.type === '(') return group();
      if (t.type === 'func') {
        pos++;
        const next = peek();
        const arg = next !== undefined && next.type === '(' ? group() : postfix();
        return FUNCTIONS[t.name](arg, ctx.angle);
      }
      throw syntaxError();
    }

    const value = expr();
    if (pos < tokens.length) throw syntaxError();
    return value;
  }

  /**
   * Evaluate an expression string.
   * @param {string} expression
   * @param {{angle?: 'deg'|'rad'|'grad', ans?: number}} [options]
   * @returns {number}
   * @throws {CalcError}
   */
  function evaluate(expression, options = {}) {
    const ctx = { angle: options.angle || 'deg', ans: options.ans ?? 0 };
    const tokens = tokenize(String(expression), ctx);
    if (tokens.length === 0) throw syntaxError();
    const value = evaluateTokens(tokens, ctx);
    if (!Number.isFinite(value)) throw mathError();
    return value;
  }

  /**
   * Format a number for display. Output is always re-parseable by evaluate().
   * Integers below 1e15 are shown exactly; everything else uses 12 significant digits,
   * which hides floating point noise (0.1+0.2 -> 0.3).
   */
  function format(value) {
    if (!Number.isFinite(value)) throw mathError();
    if (value === 0) return '0';
    if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
    const v = Number(value.toPrecision(12));
    const abs = Math.abs(v);
    if (abs >= 1e12 || abs < 1e-6) {
      return v
        .toExponential(11)
        .replace(/\.?0+e/, 'e')
        .replace('e+', 'E')
        .replace('e', 'E');
    }
    return String(v);
  }

  const CalcEngine = { evaluate, format, CalcError, SYNTAX, MATH };

  if (typeof module === 'object' && module.exports) module.exports = CalcEngine;
  else root.CalcEngine = CalcEngine;
})(typeof self !== 'undefined' ? self : this);
