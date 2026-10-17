// Runs in <head> before first paint: applies the saved theme (system/light/dark).
(function () {
  'use strict';
  let choice = 'system';
  try {
    choice = localStorage.getItem('numera.theme') || 'system';
  } catch {
    /* storage unavailable: follow the system */
  }
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
})();
