# Working on Folio

## Pushing

When a change is uncontroversial (a fix or small feature that does what was asked, tests
pass, nothing open to debate), push it straight to `main` as well as to the session branch,
without asking first. When it is a judgement call (a design choice, a behaviour change the
user may not expect, something that could break data), push to the session branch only and
ask before it goes to `main`.

Before pushing, bump the version in `app.js` (`APP_VERSION`) and `index.html`
(`folio-version`) together, and run the tests with `node --test tests/*.test.mjs`.
