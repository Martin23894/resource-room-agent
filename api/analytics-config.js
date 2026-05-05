// GET /_/analytics.js — emits a tiny script that loads Plausible if
// PLAUSIBLE_DOMAIN is set, or does nothing if it isn't.
//
// Why this shape (instead of injecting the script tag into each HTML
// file at boot): one source of truth, one cache-friendly URL. Every
// public page can include <script src="/_/analytics.js" defer></script>
// unconditionally — this endpoint decides whether to actually load
// Plausible based on env config.
//
// Plausible is privacy-friendly by default (no cookies, no PII, GDPR /
// POPIA-safe out of the box) so no banner is required. If the operator
// switches to a different provider later, only this file changes.

const SCRIPT_HOST = 'https://plausible.io';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const domain = (process.env.PLAUSIBLE_DOMAIN || '').trim();

  res.type('application/javascript; charset=utf-8');
  // Short cache — domain config rarely changes, but we don't want to
  // pin an old config for hours. 5 minutes balances cache hit-rate
  // with config-change responsiveness.
  res.set('Cache-Control', 'public, max-age=300');

  if (!domain) {
    // No analytics configured — emit a tiny no-op so the <script> tag
    // doesn't 404 in dev environments.
    return res.send('// No analytics configured.\n');
  }

  // Inject the Plausible tag dynamically. Same outcome as putting the
  // tag in the HTML directly, but driven by env config.
  const safeDomain = JSON.stringify(domain);
  const safeSrc = JSON.stringify(`${SCRIPT_HOST}/js/script.js`);
  const body = [
    '// The Resource Room — Plausible loader',
    '(function () {',
    '  var s = document.createElement("script");',
    `  s.defer = true;`,
    `  s.setAttribute("data-domain", ${safeDomain});`,
    `  s.src = ${safeSrc};`,
    '  document.head.appendChild(s);',
    '})();',
    '',
  ].join('\n');
  return res.send(body);
}
