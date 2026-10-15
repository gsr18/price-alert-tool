# Java / Browser Feature-Parity Checklist

This document compares the Java CLI source of truth with the browser engine and
lists the verification used for shared behavior. The browser implementation is
separate: it does not run the Java JAR.

| Java capability (verified in source) | Existing browser support before this upgrade | Upgrade implementation | Verification |
|---|---|---|---|
| Exactly two CLI inputs; usage/error text and exit status | Browser only accepts files; no CLI | Remains a separate local browser workflow; Java CLI is unchanged | `mvn clean test`; manual CLI fixture runs |
| UTF-8 CSV, optional BOM, exact required headers, optional extra columns, nonblank fields | Quoted CSV parser and required field validation; narrow ISO date check | Kept local upload/preview; Admin mode exposes complete source CSV; editable observation table operates on the normalized date/instrument/close fields | Browser cases for quoted fields, invalid dates, blank/width/positive close; `PriceCsvReaderTest` |
| Positive `BigDecimal` closes, arbitrary threshold `BigDecimal` | `BigInt` coefficient + decimal scale; exact comparisons | Preserved exact threshold and moving-average comparisons; numeric conversion is confined to chart drawing | Browser decimal level and MA boundary cases; Java parser/evaluator tests |
| Official `level`, `short`, `long` and legacy `threshold`, `shortWindow`, `longWindow` | Both schemas and case-insensitive rule types/directions | Guided rule creation exports official fields; raw JSON remains in Admin mode | Browser schema/alias tests and multi-case fixture |
| JSON root/schema validation; exact allowed fields; duplicate object keys, IDs, conflicting aliases, integer range | Custom raw-number scanner plus structural validation | Kept strict validation and surfaced errors in both input areas and Admin JSON editor | Browser invalid JSON, aliases, duplicate IDs/keys, windows and fields tests; `RuleJsonReaderTest` |
| Optional direction: absent means either crossing; explicit direction filters output | Implemented | Preserved in guided form, labels, analysis and raw JSON | Browser directed and legacy level/MA checks; shared fixture |
| Level boundary: previous is inclusive, current crossing is strict; first row cannot fire | Implemented | Preserved | Browser equality, touch-only, direction and crossing tests; Java evaluator tests |
| MA uses observed rows, sorted by instrument/date; full windows plus a previous full-window comparison; calendar gaps do not interrupt | Implemented using exact rolling sums and integer cross-products | Preserved; details show only the adjacent observations available in the alert context, not unreturned MA values | Browser bullish/bearish/incomplete-window/multi-instrument/unordered/date-gap tests; shared CLI fixture |
| Duplicate `(instrument,date)` observations and duplicate rule IDs rejected | Implemented | Preserved; invalid input prevents analysis | Browser duplicate cases and `AlertEngineTest` |
| Alerts ordered by date then Java `String.compareTo(ruleId)` | Ordered by date/rule ID but previously used locale collation | Changed rule-ID comparison to Java-compatible UTF-16 lexical ordering | Browser case-sensitive ID sorting test and shared fixture IDs `A-case-order` / `a-case-order` |
| Alert types/descriptions and successful no-alert output | Engine produced matching alert types/descriptions; UI had a no-alert state | Added fixture checking complete alert lines and explicit successful empty result | Multi-case expected fixture compared against Java CLI output; no-alert Java CLI run |
| No backend, uploads, or financial-data service | Files parsed in browser; sample fetched from same static origin | User/Admin experiences share one in-memory engine; no source data is stored or sent | Browser UI workflow and project-path relative asset checks |
| Browser-only UI features: file size / row limits, 4-digit date parsing, charts, forms | 5 MB, 100,000-row and decimal-scale limits documented; charts use numeric display coordinates | User/Admin UI documents limits; chart remains non-authoritative for all alert comparisons | Browser tests; see limitations below |

## Reproducible shared-fixture comparison

The browser test page loads `fixtures/parity-prices.csv`,
`fixtures/parity-rules.json`, and compares generated alerts with
`fixtures/parity-expected.json`. The fixture covers both level directions,
inclusive threshold boundaries, legacy rule fields, case-insensitive enums,
bullish and bearish MA crossovers, insufficient history, out-of-order rows,
two instruments, calendar gaps, deterministic case-sensitive rule-ID order,
and a high-precision decimal crossing.

From the repository root, after building the executable JAR, reproduce the Java
side with:

```powershell
mvn package
java -jar target/price-alert-tool-1.0-SNAPSHOT.jar web/fixtures/parity-prices.csv web/fixtures/parity-rules.json
java -jar target/price-alert-tool-1.0-SNAPSHOT.jar web/fixtures/parity-prices.csv web/fixtures/no-alert-rules.json
```

The first output must match the ordered records in `parity-expected.json`; the
second must print `No alerts generated.`. Java errors can be checked with
malformed JSON, duplicate observations, or a missing input path. The browser
test page separately asserts those validation classes. JUnit tests are still
the authoritative Java regression suite.

## Known intentional differences / boundaries

- Java `LocalDate` and the CSV library determine date syntax. The browser parser
  accepts the documented `YYYY-MM-DD` form only; expanded-year or alternate
  ISO forms accepted by Java are not guaranteed in the browser.
- Browser inputs are capped at 5 MB each and 100,000 price rows; decimal scale
  is capped at 10,000. Java's CLI has no matching limits. These are explicit
  browser resource constraints, not silent row truncation.
- Alert comparisons and descriptions preserve decimal strings with scaled
  `BigInt` arithmetic. The SVG visualization maps prices through JavaScript
  floating-point coordinates; values outside the finite display range show a
  fallback. Chart pixels are illustrative and are not used to decide alerts.
- The manual observation editor displays the latest 12 rows and, when adding
  or removing an observation, rewrites the dataset with the three required
  columns. Optional CSV columns are not preserved by that edit operation.
- Browser JavaScript and Java have not been compared for every possible input
  or every exception message. The multi-case shared fixture establishes
  verified parity for its listed cases only, not universal equivalence.
- User/Admin mode is a local UI convenience. It is not authentication and is
  not a security boundary; uploaded files stay in browser memory.
