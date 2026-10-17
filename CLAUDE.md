# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Numera Calculator: a Windows standard + scientific calculator built with Electron and plain HTML/CSS/JS (no framework, no bundler, no runtime dependencies). Full architecture write-up: `ARCHITECTURE.md`.

## Commands

```bash
npm start            # run the app from source (Electron)
npm test             # engine unit tests (node:test) — fast, no Electron needed
npm run test:ui      # end-to-end UI tests: drives the real page in a hidden Electron window
npm run dist         # build dist/Numera-Calculator-Setup-<v>.exe (NSIS) + Portable exe
npm run icon         # re-render build/icon.png from src/assets/logo.svg
```

- Single engine test: `node --test --test-name-pattern="percent" tests/engine.test.js`
- `npm test` must point at the file (`tests/engine.test.js`); `node --test tests/` fails on Windows.
- There is no linter or formatter configured.
- Run both test suites before finishing any change. UI tests print `N passed, M failed` and exit non-zero on failure.

## Architecture

Three layers, deliberately decoupled:

1. **`src/engine.js` — pure maths, no DOM.** Tokenizer + recursive-descent parser/evaluator (never `eval`). UMD-style: `module.exports` in Node (tests) and `window.CalcEngine` in the browser. Public API: `evaluate(expr, {angle, ans})`, `format(number)`, `CalcError`, `SYNTAX`, `MATH`. Errors are thrown as `CalcError` with message `'Syntax Error'` or `'Math Error'`; the UI shows the message verbatim.
2. **`src/calculator.js` — UI state + input rules.** Owns `state` (expression string, ans, memory, angle mode, 2nd, scientific, history) and a single `render()` that writes the DOM from state. All keys are declarative in `index.html` via `data-*` attributes; JS has no per-key code.
3. **`main.js` + `preload.js` — Electron shell.** Window creation, persisted settings, single-instance lock, and three IPC channels exposed through `contextBridge` as `window.calcWindow` (`setScientific`, `setTheme`, `getInfo`). The page must keep working when `window.calcWindow` is absent (tests, plain browser) — always call it with optional chaining.

### The expression string is the contract between UI and engine

The UI builds a display string and the engine parses that exact string. Symbols must stay in sync across three places when adding/changing an operator or function:
- `index.html` key attributes (`data-insert`, `data-insert2`)
- `calculator.js` lists: `CONTINUES_RESULT`, `BINARY_INPUTS`, `CHUNKS` (backspace deletes these as one unit)
- `engine.js` tables: `FUNCTIONS`, `POSTFIX`, `BINARY`/`BINARY_SYMBOLS`, `CONSTANTS`

Display symbols are Unicode (`−` U+2212, `×`, `÷`, `⁻¹`, `²`, `ʸ√`, `log₂`); the engine also accepts ASCII `- * /`. `EXP` inserts `E` (e.g. `2E−5`); lowercase `e` is Euler's number.

### Key declaration attributes (index.html)

`data-insert` text to insert · `data-insert2`/`data-label2`/`data-aria2` alternate when 2nd is on (one-shot) · `data-action` named action in `actions` · `data-key` space-separated keyboard keys · class `sci` = hidden in standard mode (its keyboard shortcuts are ignored while hidden).

### Behaviours that are easy to break

- `guardInput()` may rewrite `state.expr` (operator replacement), so `insert()` must read `state.expr` **after** calling it — `state.expr += guardInput(...)` is a known bug pattern.
- Engine rules covered by tests: `a ± b%` means b percent of a (`200+10%` = 220); `+`/`−` results that cancel to float noise become exactly 0; degree/grad angles are reduced mod one turn before trig; two adjacent literal numbers (`1.2.3`) are a syntax error; integers < 1e15 format exactly, everything else at 12 significant digits with `E` notation (`format()` output must stay re-parseable by `evaluate()`).
- Theme: `theme-boot.js` runs in `<head>` before paint (reads `localStorage['numera.theme']`); `calculator.js` owns switching and syncs `nativeTheme` via IPC so the Windows title bar matches. Colours are CSS custom properties on `:root` / `:root[data-theme='dark']` — never hard-code colours in rules.
- History list DOM is rebuilt lazily (only when the drawer opens); the drawer uses `inert` when closed.

### Tests

- `tests/engine.test.js`: grouped `node:test` cases including real-world edge cases; expected values are exact formatted strings.
- `tests/ui.e2e.js`: an Electron main script, not a node:test file. Uses a fresh temp `userData` profile each run, registers fake IPC handlers, and runs `SCENARIOS` entries `[name, pageScript, expected]` where `expected` is `{expr?, result?}` or a function returning a page-side boolean expression. Page helpers: `k(label)` click key, `keys('12+3=')`, `t(key)` keyboard, `s()` toggle Scientific, `read()`, `later(fn, ms)`. Hidden windows don't paint, so CSS transitions never finish — assert on CSS variables / data attributes, not transitioning colours.

## Build & packaging

electron-builder config lives in `package.json` → `build`. Only `main.js`, `preload.js`, `src/**` are packaged. Windows icon comes from `build/icon.png` (512×512, converted to .ico). `dist/win-unpacked`, `builder-debug.yml` and `.icon-ico` are regenerated build leftovers and safe to delete. Source is on GitHub: https://github.com/Pavi-Ashok/Numera-Calculator (`node_modules/` and `dist/` are git-ignored; release exes are attached to GitHub Releases).
