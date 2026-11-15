# README screenshots

These images show the real source app using fictional travellers **Alex** and
**Sam** and synthetic trips. The browser date is fixed to 15 November 2026 for
repeatable allowance totals. No personal travel records or real credentials are
used. The sample proof is a synthetic PDF placeholder; it is never opened or
rendered by the app.

From `web`, with dependencies and Playwright's Chromium installed:

```bash
npm run screenshots:readme
```

To use an existing Chrome installation instead:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run screenshots:readme
```

The separate screenshot configuration starts the disposable API/database/proof
storage from `tests/e2e/serve.py` and a Vite server, using ports 18080 and 15173.
It never connects to the installation on port 9067. Temporary servers and storage
are cleaned up by the runner. Keep those ports free before running it.

The capture workflow is in
[web/scripts/capture-readme.ts](../../web/scripts/capture-readme.ts), with desktop
captures at 1440 × 1000 and mobile captures at 390 × 900. Calendar and timeline
captures include the full page; the mobile proof capture contains the detail sheet.

After a refresh, inspect the PNGs for loading states, clipped content and any
unexpected data before committing them. Screenshots are documentation assets;
the capture workflow is separate from the normal browser test suite.
