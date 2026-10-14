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
each built-in assertion and the result of the shared sample fixture.

## GitHub Pages

The simplest setup is to publish the repository root: in **Settings → Pages**,
choose **Deploy from a branch**, select the repository's default branch and
`/(root)`, then save. The app is available under
`https://<owner>.github.io/<repository>/web/`. Alternatively, a Pages Actions
workflow can publish only the `web/` directory as its static artifact; there is
no build step. All application, sample, and stylesheet references are relative
so project-site paths are supported.

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
- This is historical rule evaluation, not a live feed, price prediction, or
  investment recommendation.
