# Price Alert Studio

Price Alert Studio is a static, browser-only demonstration of historical price
alerts. It is a separate JavaScript implementation of the Java CLI behavior;
the Java JAR and Maven tests do not run in the browser. Uploaded files are read
locally and are not sent to a server.

## Open locally

ES modules and sample-file fetches require a local static HTTP server. From the
repository root, run:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000/web/` in a modern browser. To run the browser-engine
checks, open `http://localhost:8000/web/engine-tests.html`. The page reports
each engine and shared-fixture assertion, plus an in-browser workflow for
uploads, rule editing, analysis, filters, exports, keyboard access, and reset
confirmation. The workflow checks for page overflow at 320, 375, 430, 768,
1024, 1440, and 1920 px. These checks run in the selected browser and are
separate from the Maven/JUnit suite.

The checklist in [`FEATURE_PARITY.md`](FEATURE_PARITY.md) documents Java
behavior, browser support, verification coverage, and known differences.

## GitHub Pages

The simplest setup is to publish the repository root: in **Settings → Pages**,
the repository's Pages workflow deploys the contents of `web/` to the site
root. Set **Build and deployment → Source** to **GitHub Actions**. The app is
then available at `https://<owner>.github.io/<repository>/`. The workflow has no
build step. All application, sample, and stylesheet references are relative.

## Sample and parity fixture

The bundled sample contains two real computed alerts: INFY crosses below 1500
on 2026-01-02, and TCS has a bullish 5/20 moving-average crossover on
2026-01-21. `samples/expected-alerts.json` is the shared expected-output
fixture used by the browser test page. It can also be supplied with
`samples/prices.csv` and `samples/rules.json` to the Java CLI for parity checks.

## Scope and limitations

- CSV and JSON files are limited to 5 MB; CSV input is limited to 100,000 price
  observations.
- Decimal calculations use scaled `BigInt` arithmetic for comparisons and MA
  crossing decisions. Decimal scale beyond 10,000 places is rejected. Chart
  coordinates use browser floating-point rendering only; this does not affect
  alert evaluation.
- The Java CLI accepts date forms beyond the browser demo's strict
  `YYYY-MM-DD` CSV check only if Java's ISO local-date parser accepts them; the
  browser intentionally validates the documented four-digit form.
- Browser-engine checks run in a browser and do not replace or modify the
  project's JUnit tests. Run the Java suite separately from the repository
  root with `mvn clean test`.
- User mode is the default, guided workspace. Admin mode reveals local raw
  JSON/CSV inspection and diagnostics; it is a UI preference, not
  authentication or a security boundary. Both modes use the same engine and
  loaded data.
- The CSV manual editor displays the latest 12 observations for removal.
  Editing an observation rewrites the CSV using the required date, instrument,
  and close columns; optional extra source columns are not retained by that
  editing action. The untouched uploaded CSV remains fully available to
  analysis until an observation is added or removed.
- The browser range filters and view sorting change only the visible alert
  list. CSV alert export contains all computed alerts, not only filtered rows.
- Shared parity fixtures include multi-instrument and date-ordering cases,
  both level directions, bullish/bearish MA crossovers, legacy rules, a
  decimal boundary, insufficient MA history, and a no-alert case. The fixture
  test checks the browser engine against the shared expected outputs; the
  Java CLI comparison is a separate reproducible check documented in
  `FEATURE_PARITY.md`.
- This is historical rule evaluation, not a live feed, price prediction, or
  investment recommendation.
