// Functional smoke tests — zero-dependency, plain Node.
// Stubs the chrome.* APIs the modules touch at import/call time, then
// exercises the real logic: list matching (regex/domain/prefix), the
// smart-freezing gate, analyzeTab protection rules, and manifest wiring.
// Run: node smoke-test.mjs  (also wired into pre-commit and CI)

import { readFileSync, existsSync } from 'node:fs';

/* -------------------------------------------------------------------------- */
/* chrome.* stub                                                              */
/* -------------------------------------------------------------------------- */

const store = { local: {}, sync: {}, session: {} };
const makeArea = (name) => ({
  get: (key, cb) => cb(typeof key === 'string' ? { [key]: store[name][key] } : { ...store[name] }),
  set: (items, cb) => { Object.assign(store[name], items); if (cb) cb(); },
  remove: (key, cb) => { delete store[name][key]; if (cb) cb(); }
});

globalThis.chrome = {
  storage: { local: makeArea('local'), sync: makeArea('sync'), session: makeArea('session') },
  runtime: { getURL: (p) => 'chrome-extension://stub/' + p, lastError: null },
  tabs: {
    query: (_q, cb) => cb([]),
    update: (_id, _props, cb) => cb && cb({}),
    get: (_id, cb) => cb(null)
  },
  scripting: { executeScript: (_opts, cb) => cb && cb([]) },
  permissions: { contains: (_p, cb) => cb(false), request: (_p, cb) => cb(false) }
};

/* -------------------------------------------------------------------------- */
/* Test runner                                                                */
/* -------------------------------------------------------------------------- */

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

function eq(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

function ok(value, msg = 'expected truthy') {
  if (!value) throw new Error(msg);
}

/* -------------------------------------------------------------------------- */
/* Imports (after the stub is in place)                                       */
/* -------------------------------------------------------------------------- */

const utils = await import('./js/utils.js');
const storage = await import('./js/storage.js');
const tabs = await import('./js/tabs.js');
const suspension = await import('./js/suspension.js');

/* -------------------------------------------------------------------------- */
/* List-entry matching (whitelist / force list)                               */
/* -------------------------------------------------------------------------- */

console.log('\nlist-entry matching');

await test('domain matches host and subdomain', () => {
  ok(utils.isWhitelisted('https://example.com/page', ['example.com']));
  ok(utils.isWhitelisted('https://www.example.com/', ['example.com']));
  ok(!utils.isWhitelisted('https://notexample.com/', ['example.com']));
});

await test('URL prefix entry prefix-matches', () => {
  ok(utils.isWhitelisted('https://youtube.com/watch?v=1', ['https://youtube.com/watch']));
  ok(!utils.isWhitelisted('https://youtube.com/feed', ['https://youtube.com/watch']));
});

await test('regex entry matches full URL, case-insensitive', () => {
  ok(utils.isWhitelisted('https://github.com/org/repo/pull/1', ['/github\\.com\\/.*\\/pull/']));
  ok(utils.isWhitelisted('https://GITHUB.com/x', ['/github/']));
  ok(!utils.isWhitelisted('https://gitlab.com/x', ['/github/']));
});

await test('invalid regex never matches and never throws', () => {
  ok(!utils.isWhitelisted('https://example.com/', ['/[unclosed/']));
});

await test('normalizeListEntry keeps regex verbatim, lowercases domains', () => {
  eq(utils.normalizeListEntry('/\\W+Admin/'), '/\\W+Admin/');
  eq(utils.normalizeListEntry('  WWW.Example.COM '), 'example.com');
});

await test('isValidListEntry accepts the three shapes, rejects junk', () => {
  ok(utils.isValidListEntry('example.com'));
  ok(utils.isValidListEntry('https://example.com/x'));
  ok(utils.isValidListEntry('/foo|bar/'));
  ok(!utils.isValidListEntry('not a domain'));
  ok(!utils.isValidListEntry('/[bad/'));
  ok(!utils.isValidListEntry('no-dot'));
});

/* -------------------------------------------------------------------------- */
/* Smart-freezing gate                                                        */
/* -------------------------------------------------------------------------- */

console.log('\nsmart-freezing gate');

const baseSettings = { ...storage.DEFAULT_SETTINGS, smartFreezingEnabled: false };

await test('gate forces the six smart checks off when master is off', () => {
  const gated = utils.gateSmartChecks(baseSettings);
  for (const k of ['protectForms', 'protectMediaElements', 'protectMeetingSites', 'protectMusicSites', 'protectLiveTitles', 'protectInteraction']) {
    eq(gated[k], false);
  }
  eq(gated.protectPinned, true); // simple guards untouched
});

await test('gate passes settings through untouched when master is on', () => {
  const on = { ...baseSettings, smartFreezingEnabled: true };
  eq(utils.gateSmartChecks(on), on);
});

/* -------------------------------------------------------------------------- */
/* analyzeTab protection rules                                                */
/* -------------------------------------------------------------------------- */

console.log('\nanalyzeTab');

const webTab = { id: 1, url: 'https://example.com/page', status: 'complete' };

await test('system and frozen URLs are structurally blocked', () => {
  eq(tabs.analyzeTab({ id: 2, url: 'chrome://extensions', status: 'complete' }).reason, 'system');
  ok(suspension.isFrozen({ url: 'chrome-extension://stub/suspended.html?url=x' }));
  eq(tabs.analyzeTab({ id: 3, url: 'chrome-extension://stub/suspended.html?url=x', status: 'complete' }).reason, 'frozen');
  ok(!suspension.isFrozen(webTab));
});

await test('active/pinned/whitelisted protections fire', () => {
  eq(tabs.analyzeTab(webTab, { activeTabIds: new Set([1]) }).reason, 'active');
  eq(tabs.analyzeTab({ ...webTab, pinned: true }).reason, 'pinned');
  eq(tabs.analyzeTab(webTab, { whitelist: ['example.com'] }).reason, 'whitelisted');
  eq(tabs.analyzeTab(webTab).ok, true);
});

await test('forced bypasses protections but never the active tab or keep-awake', () => {
  eq(tabs.analyzeTab({ ...webTab, pinned: true, audible: true }, { forced: true }).ok, true);
  eq(tabs.analyzeTab(webTab, { forced: true, activeTabIds: new Set([1]) }).reason, 'active');
  eq(tabs.analyzeTab(webTab, { forced: true, keptAwake: new Set([1]) }).reason, 'kept-awake');
  eq(tabs.analyzeTab(webTab, { forced: true, whitelist: ['example.com'] }).ok, true);
});

/* -------------------------------------------------------------------------- */
/* Settings schema                                                            */
/* -------------------------------------------------------------------------- */

console.log('\nsettings schema');

await test('DEFAULT_SETTINGS carries the new keys with deliberate defaults', () => {
  eq(storage.DEFAULT_SETTINGS.smartFreezingEnabled, false);
  eq(storage.DEFAULT_SETTINGS.discardFrozenTabs, true);
  eq(storage.DEFAULT_SETTINGS.freezeOnlyWhenMachineIdle, false);
  eq(storage.DEFAULT_SETTINGS.restoreScrollPosition, true);
});

await test('getSettings merges stored values over defaults', async () => {
  store.sync.smartFreezingEnabled = true;
  const settings = await storage.getSettings();
  eq(settings.smartFreezingEnabled, true);
  eq(settings.suspendAfterMinutes, 60);
});

/* -------------------------------------------------------------------------- */
/* Manifest wiring                                                            */
/* -------------------------------------------------------------------------- */

console.log('\nmanifest');

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

await test('background, popup, options page, and suspended page exist', () => {
  for (const f of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, 'suspended.html']) {
    ok(existsSync(f), `missing ${f}`);
  }
});

await test('all three keyboard commands are declared with suggested keys', () => {
  for (const cmd of ['suspend-active-tab', 'suspend-other-tabs', 'restore-all-tabs']) {
    ok(manifest.commands[cmd], `missing command ${cmd}`);
    ok(manifest.commands[cmd].suggested_key.default, `no suggested key for ${cmd}`);
  }
});

await test('permissions stay minimal and include idle', () => {
  ok(manifest.permissions.includes('idle'));
  ok(!manifest.permissions.includes('downloads'));
  ok(!manifest.permissions.includes('processes'));
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
