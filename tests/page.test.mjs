// The page and the script say the same version (app.js pageInStep reloads a page that doesn't).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html and app.js are of one version', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<meta name="folio-version" content="([^"]+)">/)?.[1];
  const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8').match(/const APP_VERSION = '([^']+)'/)?.[1];
  assert.ok(script, 'APP_VERSION in app.js');
  assert.equal(page, script);
});
