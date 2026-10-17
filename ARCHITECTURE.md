# Numera Calculator: Architecture & Project Guide

A Windows desktop calculator with a standard mode and a full scientific mode, light/dark themes, history, memory and keyboard support. It's built with **Electron** and plain **HTML/CSS/JavaScript**, with **zero runtime dependencies**.

---

## 1. One-minute summary (interview pitch)

> "I built Numera Calculator, a Windows desktop calculator in Electron. Its core is a maths engine I wrote from scratch: a tokenizer and a recursive-descent parser. It never uses JavaScript's `eval`, so it's safe and predictable, and I control operator precedence, implicit multiplication and error handling. The engine is pure JavaScript with no DOM access, so I unit-test it in Node with about 190 assertions, including real-world edge cases like floating-point noise, percentages and huge angles. The UI is declarative: every key is described by data attributes in the HTML, and a single render function draws the screen from one state object. The Electron shell is locked down with context isolation, the sandbox and a strict Content Security Policy, and exposes only three IPC calls. The app supports light, dark and system themes, Windows high-contrast and screen readers. It ships as an NSIS installer and a portable exe, and 76 end-to-end UI scenarios drive the real app window."

---

## 2. Tech stack and why

| Layer | Choice | Why |
|---|---|---|
| Desktop runtime | **Electron 44** | Uses web tech for a rich, themeable UI. Only Node.js was installed on the dev machine (no .NET/Python), and the same code can later target macOS. |
| UI | **Vanilla HTML/CSS/JS** | The app is small, so a framework (React etc.) would add build tooling and size with no benefit. No bundler is needed. |
| Maths | **Custom parser** (`src/engine.js`) | `eval()` is a security risk and gives JavaScript's precedence, not a calculator's. A custom parser allows implicit multiplication (`2π`), `%` rules, factorials and angle modes. |
| Tests | **`node:test`** (built into Node) + **custom Electron E2E runner** | No test dependencies. The engine tests run in milliseconds without Electron. The UI tests drive the real page. |
| Packaging | **electron-builder 26** | Produces a Windows NSIS installer and a portable exe, converts the PNG icon to `.ico`, and embeds version and publisher metadata. |
| Design | **Fluent-style CSS** with custom properties | Matches Windows 11 Calculator conventions. Themes switch by changing variables only. |

### Packages

| Package | Type | Purpose |
|---|---|---|
| `electron` ^44.9.0 | devDependency | Desktop runtime (Chromium + Node). Runs the app and the UI tests. |
| `electron-builder` ^26.15.3 | devDependency | Builds the installer and portable exe. |
| *(none)* | dependencies | **Zero runtime dependencies.** Everything shipped is our own code. |

Built-in Node modules used: `fs`, `path`, `os` (main process and tests) and `node:test` / `node:assert` (unit tests).

---

## 3. Project structure

```
Calculator APP/
├── main.js              Electron main process: window, settings, IPC, single instance
├── preload.js           Secure bridge: exposes window.calcWindow (3 functions)
├── package.json         Scripts + electron-builder config (installer, icon, metadata)
├── src/                 Everything the window loads (the "renderer")
│   ├── index.html       Markup; every key declared with data-* attributes
│   ├── styles.css       Fluent design system: light/dark tokens, layout, a11y
│   ├── theme-boot.js    Runs before first paint: applies saved theme (no flash)
│   ├── engine.js        Maths engine: tokenizer, parser, evaluator, formatter
│   ├── calculator.js    UI controller: state, input rules, render, keyboard, menus
│   └── assets/logo.svg  Brand logo (also the source of the app icon)
├── build/icon.png       512×512 app icon (generated), converted to .ico by the builder
├── scripts/make-icon.js Renders logo.svg to build/icon.png using Electron offscreen
├── tests/
│   ├── engine.test.js   19 test groups, ~190 assertions (node:test)
│   └── ui.e2e.js        76 end-to-end checks in a hidden Electron window
└── dist/                Build output: Numera-Calculator-Setup-1.0.0.exe, ...-Portable-1.0.0.exe
```

Size of the source: engine ~420 lines, UI controller ~530, CSS ~610, HTML ~160, main process ~150.

---

## 4. Architecture overview

### 4.1 Electron process model

```
┌─────────────────────────── Main process (Node.js) ───────────────────────────┐
│ main.js                                                                      │
│  • creates the BrowserWindow (sandboxed, context-isolated)                   │
│  • settings.json in %APPDATA%\Numera Calculator (window position, theme)     │
│  • single-instance lock: a second launch focuses the existing window         │
│  • IPC handlers: calc:set-scientific, calc:set-theme, calc:get-info          │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │ IPC (ipcRenderer.send / invoke)
┌───────────────┴──────── Preload (isolated world) ─────────────────────────────┐
│ preload.js: contextBridge.exposeInMainWorld('calcWindow', {                   │
│   setScientific(on), setTheme(choice), getInfo() })                           │
└───────────────▲──────────────────────────────────────────────────────────────┘
                │ window.calcWindow (only these 3 functions, no Node access)
┌───────────────┴──────── Renderer (web page, sandboxed) ───────────────────────┐
│ theme-boot.js → engine.js (window.CalcEngine) → calculator.js (UI)            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Three decoupled layers

1. **Engine (`engine.js`)**: pure functions, no DOM and no state. Input: an expression string, an angle mode and the previous answer. Output: a number, or a thrown `CalcError`.
2. **UI controller (`calculator.js`)**: owns one `state` object, applies input rules, calls the engine, and renders.
3. **Shell (`main.js` + `preload.js`)**: OS integration only. The page works without it (tests and browser), because every call uses optional chaining: `window.calcWindow?.setTheme(...)`.

**Why it matters:** the maths can be tested in isolation, the UI can be tested without the OS layer, and porting to macOS or the web only touches the shell.

### 4.3 Data flow of one key press

```
click / keydown
   → keyMap / click handler finds the <button>
   → press(button): reads data-action or data-insert (data-insert2 if 2nd is on)
   → actions[...]() or insert(text)
        insert → guardInput() fixes the input (one decimal point, operator replacement, 0. prefix…)
   → render()
        → livePreview(): engine.evaluate(closeParens(expr)) → engine.format() → faded preview
        → updates display, indicators, 2nd labels, aria-labels
"=" → equals(): evaluate → format → save to history (localStorage) → justEvaluated = true
```

---

## 5. The maths engine (`src/engine.js`) in depth

### 5.1 Pipeline

`string → tokenize() → tokens → evaluateTokens() (recursive descent) → number → format() → display string`

### 5.2 Tokenizer

- Numbers: `/^(?:\d+\.?\d*|\.\d+)(?:E[+\-−]?\d+)?/` handles `12`, `.5`, `5.`, `2E−5`.
- Words are matched **longest first** (sorted by length), so `sinh⁻¹` wins over `sinh`, which wins over `sin`.
- Constants `π` and `e` and the previous answer `Ans` become number tokens.
- **Typo guard:** two literal numbers back to back (`1.2.3` → `1.2` and `.3`) throw `Syntax Error` instead of silently multiplying.

### 5.3 Grammar (recursive descent, lowest to highest precedence)

```
expr    := term (('+' | '-') term)*
term    := unary (('×' | '÷' | 'mod') unary | <implicit ×> unary)*
unary   := ('-' | '+') unary | power
power   := postfix (('^' | 'ʸ√' | 'P' | 'C') unary)?      right-associative
postfix := primary ('!' | '%' | '²' | '³' | '⁻¹')*
primary := number | '(' expr ')'? | function ( '(' expr ')'? | postfix )
```

What the grammar gives you:
- `2+3×4 = 14` (precedence)
- `2^3^2 = 512` (right-associative power)
- `−2^2 = −4`, while `(−2)^2 = 4` (unary minus binds looser than power, as in maths)
- **Implicit multiplication:** `2π`, `3(4+1)`, `2sin(30)cos(60)`
- **Auto-close brackets:** a missing `)` at the end is accepted, so `(2+3` gives 5

### 5.4 Supported operations

| Group | Operations |
|---|---|
| Arithmetic | `+ − × ÷`, `mod`, `%`, unary ±, brackets |
| Powers/roots | `x²`, `x³`, `xʸ`, `√`, `∛`, `x ʸ√ y` (y-th root), `1/x`, `10ˣ`, `eˣ`, `2ˣ` |
| Logs | `log` (base 10), `ln`, `log₂` |
| Trig | `sin cos tan` and their inverses, in **DEG / RAD / GRAD** |
| Hyperbolic | `sinh cosh tanh` and their inverses |
| Other | `n!` (Gamma function for non-integers), `nPr`, `nCr`, `|x|`, `EXP` (×10ⁿ), `π`, `e`, `Ans`, `Rand` |

### 5.5 Numerical-accuracy decisions (good interview material)

| Problem | Solution | Example |
|---|---|---|
| Floating-point noise in display | Format to 12 significant digits | `0.1+0.2` → `0.3` |
| Noise that survives cancellation | `+`/`−` results smaller than 1e-12 × the operands become exactly 0 | `0.1+0.2−0.3` → `0` (was 5.55E-17) |
| `sin(180°)` ≈ 1.2e-16 | Exact values at multiples of 90° / 100 grad; trig results below 1e-15 become 0 | `sin(180)=0`, `tan(90)` → Math Error |
| Huge angles lose precision | Reduce degrees mod 360 (exact) **before** converting to radians | `sin(1000000°)` correct to 12 digits |
| `(−8)^(1/3)` is NaN in JavaScript | Negative base with exponent 1/odd → real odd root | → `−2` |
| Large integers shown rounded | Integers below 1e15 printed exactly | `1234567890123` |
| Percent semantics | `a ± b%` means b percent of a; elsewhere `%` = /100 | `200+10%` = 220, `200×10%` = 20 |
| Non-integer factorial | Lanczos approximation of Gamma (g=7, 9 coefficients) | `3.5!` = 11.6317283966 |
| Factorial overflow | Integers above 170 → Math Error (171! exceeds a double) | `171!` → Math Error |
| `nCr` overflow and precision | Multiplicative formula with `min(r, n−r)`, rounded | `52C5` = 2598960 |
| Round-trip | `format()` output is always re-parseable by `evaluate()` (`1E20`, `1E-8`) | results can be reused in new calculations |

### 5.6 Error model

- Two error types: **`Syntax Error`** (malformed input) and **`Math Error`** (domain or overflow: ÷0, `log(0)`, `√(−1)`, `tan(90°)`, `asin(2)`, results beyond the range of a double).
- Both are thrown as `CalcError`. The UI catches only `CalcError`, so real bugs still surface instead of being hidden.
- While typing, an incomplete expression (`5+`) shows `…`, not an error. Errors appear only on `=`.

---

## 6. UI layer (`src/calculator.js` + `index.html`)

### 6.1 State-driven rendering
A single `state` object (`expr`, `ans`, `lastResult`, `justEvaluated`, `error`, `angle`, `second`, `scientific`, `memory`, `history`) and one `render()` function. Any action mutates state and then calls `render()`. This is the same idea as React's "UI = f(state)", without the framework.

### 6.2 Declarative keys
Each key's behaviour lives in HTML attributes, so the JavaScript has no per-key code:

| Attribute | Meaning |
|---|---|
| `data-insert` | Text appended to the expression |
| `data-insert2` / `data-label2` / `data-aria2` | Alternate text, label and accessible name when **2nd** is active (one-shot) |
| `data-action` | Named action: `clear`, `back`, `equals`, `negate`, `second`, `angle`, `mc`/`mr`/`ms`/`mplus`/`mminus` |
| `data-key` | Keyboard keys mapped to this button (e.g. `"Enter ="`) |
| class `sci` | Scientific key: hidden in standard mode, and its shortcuts are ignored while hidden |

### 6.3 Input rules (`guardInput`), real-calculator behaviour
- Only one decimal point per number; `.` on an empty display becomes `0.`.
- Pressing an operator after an operator **replaces** it (`5 + ×` → `5 ×`), but `−` after `×`/`÷`/`^` makes a negative number (`2×−3`).
- A leading binary operator starts from 0 (`×5` → `0×5`).
- EXP needs a number before it, and only one exponent per number.
- Recalled values (MR, Rand) after a typed digit get an automatic `×` instead of merging digits (`5` + MR(3) → `5×3`, not `53`).
- After `=`: an operator continues from the result; a digit starts a new calculation; a negative result is inserted as `(−5)`, so `x²` gives 25.
- `±` toggles the sign of the last number; backspace deletes whole tokens such as `sin⁻¹(`.

### 6.4 Features
- **Standard / Scientific modes:** opens in standard mode. The **Scientific** button (or F2) reveals 25 scientific keys and asks the main process to grow the window (600 → 820 px, kept on screen).
- **Live preview:** a faded result updates while you type.
- **Memory:** MC, MR, M+, M−, MS, with an "M" indicator.
- **History:** a slide-out drawer with up to 100 entries saved in `localStorage`. Click or press Enter on an entry to reuse it. The list is rebuilt lazily, only when the drawer opens.
- **Keyboard:** digits, `+ - * / ^ ( ) % ! .`, Enter/`=`, Backspace, Esc (clears, or closes an open drawer or menu), `s c t l n r p e a m` for functions, F2 for Scientific, H for History, and Ctrl+C to copy the result.
- **Settings menu (⋯):** Theme (System / Light / Dark) and About.

---

## 7. Design system, theming and branding

- **Brand:** "Numera". The logo (`src/assets/logo.svg`) is a blue calculator glyph and is also the app icon. The brand accent is Fluent blue: `#0f6cbd` in light mode and `#479ef5` in dark mode. Only the `=` key and active toggles use the accent.
- **Design tokens:** every colour is a CSS custom property on `:root`, overridden in `:root[data-theme='dark']`. Switching theme only flips the `data-theme` attribute.
- **No flash on startup:** `theme-boot.js` runs in `<head>` before first paint and applies the saved theme.
- **System theme:** listens to `matchMedia('(prefers-color-scheme: dark)')` and switches live.
- **Native title bar:** the renderer sends the choice over IPC, and the main process sets `nativeTheme.themeSource` so the Windows title bar matches. The choice is also saved in `settings.json`.
- **Fluent look:** Segoe UI Variable, 4px key radius, white/grey keys (light) or charcoal keys (dark), subtle hover and pressed states.

---

## 8. Accessibility (WCAG-minded)

- Every non-digit key has an `aria-label` ("Square root", "Divide"…). Labels **swap with 2nd** ("Inverse sine") and the angle key announces its unit ("Angle unit: radians").
- The result is an `<output>` element with `aria-live="polite"`, so screen readers announce results.
- All controls are reachable with Tab and have a two-tone `:focus-visible` ring that's visible on any background.
- The menu supports arrow keys and Escape. The history drawer uses `inert` when closed, so it can't be reached with Tab or read by screen readers. History entries are focusable buttons.
- **Contrast:** every text/background pair passes WCAG AA (≥ 4.5:1) in both themes. The lowest is 4.85:1, for accent text in light mode.
- `prefers-reduced-motion` disables animations, and `forced-colors` (Windows High Contrast) switches to system colours.

---

## 9. Security

| Measure | Where | Effect |
|---|---|---|
| **No `eval`** | engine.js | User input is only ever parsed as tokens, so there's no code injection. |
| `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` | main.js | The page cannot access Node.js or the OS. |
| Minimal bridge | preload.js | Only 3 functions are exposed. Inputs are validated in main (theme must be one of 3 values; sizes are fixed). |
| Content Security Policy | index.html | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'`: no inline scripts, no remote code. |
| Navigation blocked | main.js | `will-navigate` is prevented and `setWindowOpenHandler` denies new windows. |
| No network | — | The app makes no network requests. |

---

## 10. Persistence

| Data | Stored in | Notes |
|---|---|---|
| History (100 max) | `localStorage['numera.history']` | Inside the app's Chromium profile |
| Theme choice | `localStorage['numera.theme']` **and** `settings.json` | localStorage for the page (pre-paint); settings.json so main can theme the window before load |
| Window position and width | `%APPDATA%\Numera Calculator\settings.json` | Saved on close; restored only if still on a connected display |

All storage access is wrapped in `try/catch`, so the app still works if storage is unavailable.

---

## 11. Window and OS integration (`main.js`)

- **Single instance:** `app.requestSingleInstanceLock()`. A second launch focuses and restores the existing window (verified on the packaged build).
- **AppUserModelID** `com.numera.calculator` for correct taskbar grouping and identity.
- **Mode-aware sizing:** standard 400×600 (min 340×520), scientific 820 tall (min 660). Growth is clamped so the window stays on screen.
- Shown only on `ready-to-show`, with a theme-matched background colour, so there's no white flash.
- **Icon:** the packaged exe embeds its icon; during development the window uses `build/icon.png`.

---

## 12. Build and distribution

```
npm run icon   → scripts/make-icon.js renders logo.svg to build/icon.png (512×512, transparent)
npm run dist   → electron-builder --win
                   • packages main.js, preload.js, src/** into resources/app.asar
                   • converts build/icon.png to .ico and embeds it in the exe
                   • stamps metadata: ProductName "Numera Calculator", version, Company "Numera", copyright
                   • NSIS installer: per-user, choose install folder, Start-menu + desktop shortcuts, uninstaller
                   • Portable exe: runs without installing
```

| Output | Size |
|---|---|
| `Numera-Calculator-Setup-1.0.0.exe` | ~96 MB |
| `Numera-Calculator-Portable-1.0.0.exe` | ~96 MB |

Size is dominated by the bundled Chromium + Node runtime that every Electron app ships. The app code itself is under 100 KB. Disabling differential (auto-update) packaging cut ~10 MB.

---

## 13. Testing strategy

### 13.1 Engine unit tests: `npm test` (`node:test`, ~190 assertions in 19 groups)
Core groups: precedence, powers, implicit multiplication, auto-close, trig in 3 angle modes, hyperbolic, logs/roots, factorial/nCr/percent, formatting, errors.
**Real-world edge-case groups:** floating-point noise, very large and very small numbers, desktop-style percent, signs and negatives, typos, special angles, round-trips (`10^(log 7) = 7`), combinatorics bounds, mod and mixed precedence.

### 13.2 End-to-end UI tests: `npm run test:ui` (76 checks)
A custom Electron script loads the real `index.html` in a hidden window, with a **fresh temporary profile** each run (hermetic) and fake IPC handlers. Each scenario is `[name, script, expected]`. Helpers click keys by label, send keyboard events and read the display.
Coverage includes the Scientific toggle and window-resize requests, input rules, memory, 2nd, angle modes, keyboard shortcuts, history (mouse and keyboard), theme switching and persistence, the menu, About, branding, and accessibility names.

### 13.3 Bugs the tests caught (good interview stories)
1. **`0.1+0.2−0.3` showed 5.55E-17**: fixed with relative cancellation to zero.
2. **`200+10%` gave 200.1**: implemented desktop percent semantics.
3. **`1.2.3` silently computed 0.36**: tokenizer typo guard, plus a UI rule allowing one decimal point per number.
4. **Operator replacement silently failed**: `state.expr += guardInput(...)` read `state.expr` *before* the function rewrote it (JavaScript evaluates the left operand first). Fixed by calling the guard first.
5. **MR after a digit merged numbers (`53`)**: recalled values now insert `×`.
6. **`sin(1000000°)` wrong in the last digit**: reduce the angle mod 360 before converting.
7. **`(−8)^(1/3)` gave Math Error**: real odd-root handling.
8. **Test flakiness from shared state**: the UI tests now use a temporary profile per run.

Verified manually as well: screenshots of both themes in both modes, a launch of the packaged exe, and the single-instance behaviour.

---

## 14. Performance

- The engine tokenizes and evaluates in a single left-to-right pass (O(n) in expression length). Expressions are short, so evaluation is effectively instant.
- `render()` updates only text and classes. The 2nd-function keys are cached once, and their labels are rewritten only when the 2nd state changes.
- The history DOM (up to 100 nodes) is rebuilt only when the drawer opens, not on every `=`.
- No framework and no bundle: the page loads 4 small local files.

---

## 15. Known limitations and future work

- **Windows only for now.** macOS needs an app menu (Cmd+Q/C/V), Cmd+C copy, a `.icns` icon, building on a Mac (or CI), and Apple signing/notarisation ($99/yr) to avoid Gatekeeper warnings.
- **Unsigned exe.** Windows SmartScreen warns on first run; a code-signing certificate would fix that.
- **Precision:** IEEE-754 doubles with 12-digit display. Arbitrary precision would need a decimal library.
- **`mod` uses truncated remainder** (`−7 mod 3 = −1`), like most programming languages; some calculators return 2.
- **Size:** ~96 MB because of Electron. Tauri or native WinUI would be much smaller, at the cost of a rewrite.
- **No auto-update channel** and no CI build yet.

---

## 16. Likely interview questions (with answers)

**Why not use `eval()`?**
It executes arbitrary JavaScript, which is a security hole. It also follows JavaScript semantics rather than a calculator's: no implicit multiplication, `^` is XOR, and there are no factorials or degree mode. A custom parser gives full control and clean error messages.

**Why recursive descent rather than shunting-yard?**
Each precedence level is one small function, so the grammar reads like the code. Unary minus, postfix operators, implicit multiplication and right-associative powers fit naturally. Both approaches are O(n).

**How do you handle floating-point errors?**
Three layers. Display uses 12 significant digits. Addition and subtraction snap results to zero when they cancel below 1e-12 of the operands. Trig returns exact values at quarter turns and reduces angles before converting them.

**How is the Electron app secured?**
Context isolation, the sandbox, no Node in the renderer, a strict CSP, blocked navigation, and a three-function preload bridge whose inputs are validated in the main process.

**How did you test the UI?**
A custom Electron harness drives the real page: it clicks keys, sends keyboard events, and asserts on the display, the DOM attributes and the IPC calls. Each run uses a fresh profile, so tests are independent. Hidden windows don't paint, so assertions use CSS variables rather than colours that are mid-transition.

**How does theming work without a flash?**
A tiny script in `<head>` sets `data-theme` before first paint. All colours are CSS variables. The main process mirrors the choice to `nativeTheme` so the native title bar matches.

**What would you change at scale?**
Add CI, code signing, auto-updates, a macOS build, TypeScript for the engine's token types, and possibly Tauri to cut the size.

## 17. where and How to share the .exe file
 
E:\AI Products\Calculator APP\dist\:

┌──────────────────────────────────────┬───────────────────────┬──────────────────────────────────────────────────┐
│                 File                 │       Best for        │                   What they do                   │
├──────────────────────────────────────┼───────────────────────┼──────────────────────────────────────────────────┤
│ Numera-Calculator-Portable-1.0.0.exe │ Quick try-out         │ Double-click and it runs. Nothing is             │
│                                      │ (recommended)         │ installed.                                       │
├──────────────────────────────────────┼───────────────────────┼──────────────────────────────────────────────────┤
│ Numera-Calculator-Setup-1.0.0.exe    │ Someone who'll keep   │ Runs an installer that adds Start-menu and       │
│                                      │ using it              │ desktop shortcuts and an uninstaller.            │
└──────────────────────────────────────┴───────────────────────┴──────────────────────────────────────────────────┘

Tell them to expect two warnings. Both are normal, because the app isn't signed with a paid certificate:
1. Browser download warning (e.g. Chrome's "isn't commonly downloaded"): choose Keep.
2. Windows SmartScreen ("Windows protected your PC"): click More info, then Run anyway. This appears only the first time.

Message you can send with the link:

▎ "Here's my calculator app. Download it and double-click to open. Windows may show 'Windows protected your PC' because it's not from the Microsoft Store: click More info → Run anyway."

Requirements for their laptop
- Windows 10 or 11, 64-bit. Windows on ARM laptops also work, through Windows' built-in emulation.
- Not on Mac or Linux. Those need separate builds (the macOS changes we discussed earlier).