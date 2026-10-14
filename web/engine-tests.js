import { parsePrices, parseRules, runAnalysis } from "./engine.js";
import { alertsToCsv } from "./export.js";

const results = document.getElementById("test-results");
const summary = document.getElementById("test-summary");
let passed = 0;
let failed = 0;
const pendingTests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, callback) {
  pendingTests.push(Promise.resolve().then(callback).then(
    () => addResult(name, true, "Assertion passed"),
    (error) => addResult(name, false, error.message)
  ));
}

function addResult(name, success, detail) {
  const row = document.createElement("tr");
  const cells = [document.createElement("td"), document.createElement("td"),
    document.createElement("td")];
  if (success) passed += 1;
  else failed += 1;
  cells[0].textContent = success ? "PASS" : "FAIL";
  cells[0].style.color = success ? "var(--success)" : "var(--danger)";
  cells[1].textContent = name;
  cells[2].textContent = detail;
  cells.forEach((cell) => row.append(cell));
  results.append(row);
}

const level = (direction = undefined, threshold = "10", id = "L") =>
  parseRules(JSON.stringify([{ id, instrument: "ABC", type: "level",
    ...(direction ? { direction } : {}), threshold }]))[0];
const ma = (direction, short = 1, long = 2) =>
  parseRules(JSON.stringify([{ id: "M", instrument: "ABC", type: "ma_cross",
    short, long, ...(direction ? { direction } : {}) }]))[0];
const prices = (...values) => parsePrices(`date,instrument,close\n${
  values.map((value, index) => `2026-01-${String(index + 1).padStart(2, "0")},ABC,${value}`).join("\n")
}\n`);

test("level above crossing", () => {
  assert(runAnalysis(prices("9", "11"), [level("above")])[0].alertType === "LEVEL_UP", "Expected LEVEL_UP");
});
test("level below crossing", () => {
  assert(runAnalysis(prices("11", "9"), [level("below")])[0].alertType === "LEVEL_DOWN", "Expected LEVEL_DOWN");
});
test("equality at previous observation crosses", () => {
  assert(runAnalysis(prices("10", "11"), [level("above")]).length === 1, "Equality should count as crossing origin");
  assert(runAnalysis(prices("10", "9"), [level("below")]).length === 1, "Equality should count as crossing origin");
});
test("no alert when remaining on same side", () => {
  assert(runAnalysis(prices("12", "11"), [level("above")]).length === 0, "No upward crossing occurred");
});
test("touching without crossing produces no alert", () => {
  assert(runAnalysis(prices("9", "10"), [level("above")]).length === 0, "Touch alone is not a crossing");
});
test("wrong-direction level crossing is ignored", () => {
  assert(runAnalysis(prices("9", "11"), [level("below")]).length === 0, "Below rule must ignore upward cross");
});
test("legacy level rule infers both directions", () => {
  assert(runAnalysis(prices("9", "11"), [level()])[0].alertType === "LEVEL_UP", "Legacy above crossing missing");
  assert(runAnalysis(prices("11", "9"), [level()])[0].alertType === "LEVEL_DOWN", "Legacy below crossing missing");
});
test("bullish MA crossover", () => {
  assert(runAnalysis(prices("10", "8", "9"), [ma("above")])[0].alertType === "MA_BULLISH", "Expected bullish crossover");
});
test("bearish MA crossover", () => {
  assert(runAnalysis(prices("8", "10", "9"), [ma("below")])[0].alertType === "MA_BEARISH", "Expected bearish crossover");
});
test("MA does not cross when averages remain on same side", () => {
  assert(runAnalysis(prices("10", "11", "12", "13"), [ma("above")]).length === 0, "Unexpected crossover");
});
test("wrong-direction MA crossover is ignored", () => {
  assert(runAnalysis(prices("10", "8", "9"), [ma("below")]).length === 0, "Wrong direction triggered");
});
test("incomplete moving-average windows do not trigger", () => {
  assert(runAnalysis(prices("10", "8"), [ma("above")]).length === 0, "Incomplete window triggered");
});
test("observations are isolated by instrument", () => {
  const input = parsePrices("date,instrument,close\n2026-01-01,ABC,10\n2026-01-01,XYZ,1\n2026-01-02,ABC,8\n2026-01-02,XYZ,100\n2026-01-03,ABC,9\n");
  assert(runAnalysis(input, [ma("above")]).length === 1, "ABC's crossover should not be changed by XYZ values");
});
test("unordered CSV is sorted chronologically for analysis", () => {
  const input = parsePrices("date,instrument,close\n2026-01-03,ABC,11\n2026-01-01,ABC,9\n2026-01-02,ABC,10\n");
  const alert = runAnalysis(input, [level("above")])[0];
  assert(alert.date === "2026-01-03", "Crossing date did not follow chronological order");
});
test("official and case-insensitive schemas normalize", () => {
  const rules = parseRules('[{"id":"r1","instrument":"ABC","type":"LEVEL","direction":"BELOW","level":10},{"id":"r2","instrument":"ABC","type":"Ma_Cross","direction":"above","short":1,"long":2}]');
  assert(rules[0].direction === "BELOW" && rules[0].threshold.coefficient === 10n, "Level schema not normalized");
  assert(rules[1].shortWindow === 1 && rules[1].longWindow === 2, "MA aliases not normalized");
});
test("legacy MA schema infers both directions", () => {
  const rule = parseRules('[{"id":"M","instrument":"ABC","type":"MA_CROSS","shortWindow":1,"longWindow":2}]')[0];
  assert(runAnalysis(prices("8", "10", "9"), [rule])[0].alertType === "MA_BEARISH", "Legacy inference lost");
});
test("duplicate IDs and observations are rejected", () => {
  let duplicateId = false;
  let duplicatePrice = false;
  try { parseRules('[{"id":"x","instrument":"ABC","type":"LEVEL","level":1},{"id":"x","instrument":"ABC","type":"LEVEL","level":1}]'); } catch { duplicateId = true; }
  try { runAnalysis(prices("9", "11").concat(prices("9").map((row) => ({ ...row, date: "2026-01-01" }))), [level("above")]); } catch { duplicatePrice = true; }
  assert(duplicateId && duplicatePrice, "Duplicate IDs/observations must be rejected");
});
test("duplicate JSON properties are rejected", () => {
  let rejected = false;
  try { parseRules('[{"id":"x","id":"y","instrument":"A","type":"LEVEL","level":1}]'); }
  catch { rejected = true; }
  assert(rejected, "Duplicate property was accepted");
});
test("invalid aliases, directions, windows, and unknown fields are rejected", () => {
  const invalid = [
    '[{"id":"x","instrument":"A","type":"LEVEL","direction":"sideways","level":1}]',
    '[{"id":"x","instrument":"A","type":"LEVEL","threshold":1,"level":2}]',
    '[{"id":"x","instrument":"A","type":"MA_CROSS","short":2,"long":2}]',
    '[{"id":"x","instrument":"A","type":"LEVEL","level":1,"extra":1}]',
    '[{"id":"x","instrument":"A","type":"MA_CROSS","short":1}]',
    '[{"id":"x","instrument":"A","type":"MA_CROSS","short":1.0,"long":2}]',
    '[{"id":"x","instrument":"A","type":"MA_CROSS","short":1,"long":2147483648}]'
  ];
  assert(invalid.every((text) => {
    try { parseRules(text); return false; } catch { return true; }
  }), "One or more invalid rule examples were accepted");
});
test("quoted CSV values and commas are parsed safely", () => {
  const parsed = parsePrices('date,instrument,close,note\n2026-01-01,"A, B",10,"close, final"\n');
  assert(parsed[0].instrument === "A, B", "Quoted comma was not preserved");
});
test("invalid CSV dates, non-positive closes, and record widths are rejected", () => {
  const invalid = [
    "date,instrument,close\n2026-02-30,ABC,1\n",
    "date,instrument,close\n2026-01-01,ABC,0\n",
    "date,instrument,close\n2026-01-01,ABC,1,extra\n"
  ];
  assert(invalid.every((text) => {
    try { parsePrices(text); return false; } catch { return true; }
  }), "One or more invalid CSV inputs were accepted");
});
test("decimal comparison preserves values beyond floating precision", () => {
  const input = prices("1.0000000000000000000000000001", "1.0000000000000000000000000002");
  const rule = parseRules('[{"id":"tiny","instrument":"ABC","type":"level","direction":"above","level":1.00000000000000000000000000015}]');
  const alerts = runAnalysis(input, rule);
  assert(alerts.length === 1 && alerts[0].alertType === "LEVEL_UP", "High precision crossing lost");
});
test("valid empty rules produce no alerts", () => {
  assert(runAnalysis(prices("9", "11"), parseRules("[]")).length === 0, "Expected no alerts");
});
test("results sort by date, then rule ID", () => {
  const input = parsePrices("date,instrument,close\n2026-01-01,ABC,9\n2026-01-02,ABC,11\n");
  const rules = parseRules('[{"id":"z","instrument":"ABC","type":"LEVEL","level":10},{"id":"a","instrument":"ABC","type":"LEVEL","level":10}]');
  const alerts = runAnalysis(input, rules);
  assert(alerts.map((alert) => alert.ruleId).join(",") === "a,z", "Alerts are not deterministically ordered");
});
test("CSV export quotes commas, quotes, and newlines", () => {
  const csv = alertsToCsv([{
    date: "2026-01-02", ruleId: 'r,"1', instrument: "A, B", alertType: "LEVEL_UP",
    description: 'line 1,\n"quoted"'
  }]);
  assert(csv === '"date","ruleId","instrument","alertType","description"\r\n' +
    '"2026-01-02","r,""1","A, B","LEVEL_UP","line 1,\n""quoted"""',
  "CSV fields were not escaped correctly");
});
test("sample fixture matches shared expected Java CLI output", async () => {
  const [priceText, ruleText, expectedText] = await Promise.all([
    fetch("./samples/prices.csv").then((response) => response.text()),
    fetch("./samples/rules.json").then((response) => response.text()),
    fetch("./samples/expected-alerts.json").then((response) => response.text())
  ]);
  const actual = runAnalysis(parsePrices(priceText), parseRules(ruleText))
    .map(({ date, ruleId, instrument, alertType, description }) =>
      ({ date, ruleId, instrument, alertType, description }));
  assert(JSON.stringify(actual) === JSON.stringify(JSON.parse(expectedText)),
    `Shared parity fixture mismatch: ${JSON.stringify(actual)}`);
});
test("browser UI loads sample, shows alerts, and accepts spaced filenames", async () => {
  const frame = document.createElement("iframe");
  frame.title = "Price Alert Studio interaction check";
  frame.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(frame);
  try {
    await new Promise((resolve, reject) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.src = "./index.html";
      window.setTimeout(() => reject(new Error("App page did not load")), 10000);
    });
    const app = frame.contentDocument;
    const waitFor = (predicate, message) => new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (predicate()) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(app.body, { childList: true, subtree: true, characterData: true, attributes: true });
      if (predicate()) {
        observer.disconnect();
        resolve();
      }
      window.setTimeout(() => {
        observer.disconnect();
        reject(new Error(message));
      }, 10000);
    });

    app.getElementById("load-sample").click();
    await waitFor(() => app.getElementById("analysis-message").textContent.includes("Sample data loaded"),
      "Sample data did not load");
    app.getElementById("run-analysis").click();
    await waitFor(() => app.getElementById("result-alerts").textContent === "2",
      "Sample result did not render");
    assert(app.querySelectorAll("#alert-rows tr").length === 2, "Expected two visible sample alerts");
    assert(app.getElementById("alert-type").options.length === 3,
      "Alert type filter did not reflect actual result types");
    assert(!app.getElementById("export-alerts").disabled,
      "Export action is not enabled after a completed analysis");
    assert(app.querySelector("#alert-rows tr").textContent.includes("2026-01-02"),
      "Default result order/date was not shown");
    assert(app.querySelector("#chart-area svg polyline.chart-line"),
      "Price chart did not render actual sample observations");
    app.getElementById("alert-type").value = "LEVEL_DOWN";
    app.getElementById("alert-type").dispatchEvent(new Event("change", { bubbles: true }));
    assert(app.querySelectorAll("#alert-rows tr").length === 1, "Alert type filter did not narrow results");
    app.getElementById("clear-filters").click();
    assert(app.querySelectorAll("#alert-rows tr").length === 2, "Clear filters did not restore results");
    app.querySelector("#alert-rows tr").click();
    assert(app.getElementById("alert-detail").textContent.includes("1501.00"),
      "Selected alert detail omitted actual decimal input");
    const toggle = app.querySelector(".theme-toggle");
    toggle.click();
    assert(app.documentElement.dataset.theme === "light" &&
      toggle.getAttribute("aria-label") === "Switch to dark theme", "Theme toggle state/label is incorrect");

    const attach = (id, name, contents, type) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([contents], name, { type }));
      const input = app.getElementById(id);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    attach("prices-file", "history with spaces.csv",
      'date,instrument,close\n2026-02-01,"A, B",9\n2026-02-02,"A, B",11\n', "text/csv");
    attach("rules-file", "rules with spaces.json",
      '[{"id":"space","instrument":"A, B","type":"level","direction":"above","level":10}]',
      "application/json");
    await waitFor(() => app.getElementById("input-status").textContent ===
      "2 observations and 1 rules are ready.",
      "Custom files with spaced names were not accepted");
    app.getElementById("run-analysis").click();
    await waitFor(() => app.getElementById("result-alerts").textContent === "1",
      "Custom file analysis did not produce its expected alert");
    attach("prices-file", "touch only.csv",
      "date,instrument,close\n2026-03-01,ABC,9\n2026-03-02,ABC,10\n2026-03-03,ABC,9\n", "text/csv");
    await waitFor(() => app.getElementById("input-status").textContent ===
      "3 observations and 1 rules are ready.", "No-alert input pair was not accepted");
    app.getElementById("run-analysis").click();
    await waitFor(() => app.getElementById("result-alerts").textContent === "0",
      "Valid no-alert analysis did not complete");
    assert(!app.getElementById("no-alerts").hidden &&
      app.getElementById("alert-table").hidden, "No-alert completion state was not displayed");
    attach("rules-file", "invalid rules.json", "[", "application/json");
    await waitFor(() => app.getElementById("rules-error").textContent.length > 0,
      "Invalid rules JSON did not produce a visible error");
    assert(app.getElementById("run-analysis").disabled, "Analysis remained enabled with invalid rules");
    frame.style.width = "375px";
    frame.style.height = "812px";
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    assert(app.documentElement.scrollWidth <= app.documentElement.clientWidth,
      "Mobile layout has horizontal page overflow");
  } finally {
    frame.remove();
  }
});

await Promise.all(pendingTests);
summary.textContent = `${passed} passed · ${failed} failed`;
summary.style.color = failed ? "var(--danger)" : "var(--success)";
