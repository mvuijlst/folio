// Fills in `after` where a fixture has none, with what works.js makes of `before`. Read the
// result against section 6.4 of docs/work-edition-plan.md before trusting it: the fixtures
// are the specification both sides are tested against.
//   node tests/fixtures/works/make-after.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { upgrade } from '../../../works.js';

const dir = new URL('./', import.meta.url);
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const f = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  if (f.after || !f.before || Array.isArray(f.before)) continue;
  f.after = upgrade(f.before, f.status);
  writeFileSync(new URL(name, dir), JSON.stringify(f, null, 2) + '\n');
  console.log('filled', name);
}
