# Price Alert Tool

Java 21 command-line tool that checks historical closing prices for configured level crossings and moving-average crossovers. Alerts report that a rule was met; they do not predict future prices.

## Prerequisites and run

Install JDK 21 and Maven 3.6.3 or newer. From a clean checkout, open a terminal in the project directory and run:

```powershell
mvn clean package
java -jar target/price-alert-tool-1.0-SNAPSHOT.jar prices.csv rules.json
```

The standalone shaded JAR takes exactly two arguments: prices CSV, then rules JSON. The CSV headers are `date,instrument,close`; dates use `YYYY-MM-DD`, and closes must be positive decimals. The sample files demonstrate the official explicit-direction JSON format:

```json
[
  {"id":"r1","instrument":"INFY","type":"level","direction":"below","level":1500},
  {"id":"r2","instrument":"TCS","type":"ma_cross","short":1,"long":2,"direction":"above"}
]
```

Legacy rules remain supported: use `threshold` for a level or `shortWindow`/`longWindow` for a moving average. Omitting `direction` preserves the previous behavior of detecting either crossing. If both official and legacy aliases are supplied, their values must agree.

## Tests and interactive runner

Run the complete JUnit 5 suite and optional tagged categories:

```powershell
mvn clean test
mvn test -DtestGroups=engine
mvn test -DtestGroups=csv
mvn test -DtestGroups=json
mvn test -DtestGroups=validation
mvn test -DtestGroups=cli
```

On Windows, run `.\test-runner.ps1` in PowerShell for User and Admin / Developer workspaces, sample scenarios, custom files, test reports, and logs. Developer options use a local convenience passkey; it is not a security boundary.

## Browser demonstration

The separate static **Price Alert Studio** is in `web/`. Start a local server from the repository root with `python -m http.server 8000`, then open `http://localhost:8000/`; the root page redirects to `web/`. You can also open `http://localhost:8000/web/` directly. The GitHub Pages workflow publishes the contents of `web/` at the site root, so the site URL is `https://gsr18.github.io/price-alert-tool/`.

To enable deployment, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. The workflow deploys on pushes to `main` and can also be started manually from the repository's **Actions** tab. It publishes only `web/`; the root redirect remains in the repository but is not needed for the deployed site. The site runs its own browser-side implementation; the Java CLI and Maven tests remain separate. Deployment has not been performed as part of this change. See [`web/README.md`](web/README.md) for local test instructions and limitations.

## AI assistance

AI assistance was used to implement and review the CLI, file parsing, validation, tests, and documentation, with requests to preserve existing behavior and tests. The first AI-assisted rule reader retained the older `threshold` and `shortWindow`/`longWindow` schema, overlooking the assessment's `level`, `short`, `long`, and explicit `direction` fields. The compliance review corrected this by supporting both schemas and adding regression tests for directed crossings and legacy behavior.
