// jsdom implements no layout, so a few DOM methods real components call simply
// do not exist there. When one is called from an effect or a promise callback
// rather than inside the test body, the TypeError escapes as an unhandled
// error: every test still passes, the run reports "1 error", and the process
// exits non-zero. That is a flake nobody can act on, because nothing failed.
//
// Installing the no-ops once, for every file, is what makes that impossible.
// Doing it inside a single test — as WriteScreen.test.tsx used to — only
// protects tests that happen to run after it, and file order is not fixed.
//
// `??=` so a test that wants to assert on one of these can still install its
// own spy without being clobbered here.
// Guarded: this file runs for every test, and the pure-logic suites use the
// node environment where there is no DOM at all.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= function scrollIntoView() {}
  Element.prototype.scrollTo ??= function scrollTo() {}
}
if (typeof window !== 'undefined') {
  window.scrollTo ??= function scrollTo() {}
}
