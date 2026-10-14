import {
  formatDecimal,
  normalizedRuleLabel,
  parsePrices,
  parseRules,
  runAnalysis
} from "./engine.js";
import { alertsToCsv } from "./export.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const state = {
  prices: null,
  rules: null,
  pricesFile: null,
  rulesFile: null,
  alerts: null,
  selectedAlertKey: null,
  search: "",
  type: "",
  sort: "date",
  sortDirection: 1
};

const byId = (id) => document.getElementById(id);
const fileInputs = {
  prices: { input: byId("prices-file"), zone: byId("prices-drop") },
  rules: { input: byId("rules-file"), zone: byId("rules-drop") }
};

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector(".theme-toggle");
  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${nextTheme} theme`;
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  safeStorageSet("price-alert-studio-theme", theme);
}

function initializeTheme() {
  const stored = safeStorageGet("price-alert-studio-theme");
  const systemTheme = window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light" : "dark";
  applyTheme(stored === "light" || stored === "dark" ? stored : systemTheme);
}

function setFileError(kind, message) {
  byId(`${kind}-error`).textContent = message;
  fileInputs[kind].zone.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearResults() {
  state.alerts = null;
  state.selectedAlertKey = null;
  byId("overview-alerts").textContent = "—";
  byId("overview-state").textContent = "Run an analysis to begin";
  byId("result-alerts").textContent = "—";
  byId("result-instruments").textContent = "—";
  byId("result-rules").textContent = "—";
  byId("result-range").textContent = "—";
  byId("results-caption").textContent = "Run an analysis to reveal verified signals.";
  byId("alert-rows").replaceChildren();
  byId("results-placeholder").hidden = false;
  byId("no-alerts").hidden = true;
  byId("no-matches").hidden = true;
  byId("alert-table-wrap").hidden = false;
  byId("result-visible-count").textContent = "No result set";
  byId("export-alerts").disabled = true;
  byId("type-breakdown").textContent = "No computed alerts yet.";
  byId("alert-detail").textContent = "Select an alert row to inspect the rule and observed values.";
  renderChart();
}

function updateOverview() {
  const instruments = new Set((state.prices || []).map((row) => row.instrument));
  byId("overview-instruments").textContent = String(instruments.size);
  byId("overview-observations").textContent = String(state.prices?.length || 0);
  byId("overview-rules").textContent = String(state.rules?.length || 0);
}

function setSelectedFile(kind, file) {
  const container = byId(`${kind}-selected`);
  container.replaceChildren();
  if (!file) {
    container.hidden = true;
    state[`${kind}File`] = null;
    return;
  }
  state[`${kind}File`] = file;
  container.hidden = false;
  const name = document.createElement("span");
  name.textContent = `${file.name} · ${formatBytes(file.size)}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${file.name}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    fileInputs[kind].input.value = "";
    state[kind] = null;
    setSelectedFile(kind, null);
    setFileError(kind, "");
    updatePreviews();
    updateOverview();
    clearResults();
  });
  container.append(name, remove);
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readSelectedFile(kind, file) {
  clearResults();
  state[kind] = null;
  setFileError(kind, "");
  setSelectedFile(kind, file);
  if (file.size > MAX_FILE_BYTES) {
    setFileError(kind, "This file is larger than 5 MB. Choose a smaller file.");
  } else {
    try {
      const text = await file.text();
      state[kind] = kind === "prices" ? parsePrices(text) : parseRules(text);
      byId("analysis-message").textContent = "";
      byId("analysis-message").className = "analysis-message";
    } catch (error) {
      setFileError(kind, error.message);
    }
  }
  updatePreviews();
  updateOverview();
}

function renderPricePreview() {
  const body = byId("price-preview");
  body.replaceChildren();
  (state.prices || []).slice(0, 8).forEach((record) => {
    const row = document.createElement("tr");
    for (const value of [record.date, record.instrument, formatDecimal(record.close)]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === formatDecimal(record.close)) cell.className = "numeric";
      row.append(cell);
    }
    body.append(row);
  });
  byId("price-preview-count").textContent = state.prices
    ? `${Math.min(state.prices.length, 8)} shown · ${state.prices.length} total` : "";
}

function renderRulePreview() {
  const list = byId("rule-preview");
  list.replaceChildren();
  (state.rules || []).forEach((rule) => {
    const item = document.createElement("div");
    item.className = "rule-preview-item";
    const title = document.createElement("strong");
    title.textContent = rule.id;
    const definition = document.createElement("span");
    definition.textContent = normalizedRuleLabel(rule);
    item.append(title, definition);
    list.append(item);
  });
  byId("rule-preview-count").textContent = state.rules ? `${state.rules.length} rules` : "";
}

function updatePreviews() {
  const ready = state.prices !== null && state.rules !== null;
  byId("preview-empty").hidden = ready;
  byId("preview-content").hidden = !ready;
  byId("preview-count").textContent = ready
    ? `${state.prices.length} observations · ${state.rules.length} rules`
    : "Waiting for valid files";
  if (ready) {
    renderPricePreview();
    renderRulePreview();
  } else {
    byId("price-preview").replaceChildren();
    byId("rule-preview").replaceChildren();
  }
  const hasErrors = ["prices", "rules"].some((kind) => byId(`${kind}-error`).textContent);
  byId("run-analysis").disabled = !ready || hasErrors;
  byId("input-status").textContent = ready
    ? `${state.prices.length} observations and ${state.rules.length} rules are ready.`
    : "Load both valid files to preview your analysis.";
  byId("input-status").classList.toggle("ready", ready && !hasErrors);
}

function instrumentDateRange(prices) {
  if (!prices.length) return "—";
  const dates = prices.map((row) => row.date).sort();
  return dates.length === 1 ? dates[0] : `${dates[0]} – ${dates.at(-1)}`;
}

function alertKey(alert) {
  return `${alert.date}\u0000${alert.ruleId}\u0000${alert.alertType}`;
}

function filteredAlerts() {
  if (!state.alerts) return [];
  const search = state.search.trim().toLocaleLowerCase();
  return state.alerts.filter((alert) =>
    (!search || alert.instrument.toLocaleLowerCase().includes(search) ||
      alert.ruleId.toLocaleLowerCase().includes(search)) &&
    (!state.type || alert.alertType === state.type)
  );
}

function renderAlerts() {
  const body = byId("alert-rows");
  body.replaceChildren();
  const rows = filteredAlerts();
  if (state.sort !== "date") {
    rows.sort((left, right) =>
      String(left[state.sort]).localeCompare(String(right[state.sort])) * state.sortDirection ||
      left.date.localeCompare(right.date) || left.ruleId.localeCompare(right.ruleId)
    );
  } else if (state.sortDirection < 0) {
    rows.reverse();
  }
  rows.forEach((alert) => {
    const row = document.createElement("tr");
    row.tabIndex = 0;
    row.setAttribute("aria-selected", alertKey(alert) === state.selectedAlertKey ? "true" : "false");
    row.setAttribute("aria-label", `${alert.date}, ${alert.ruleId}, ${alert.instrument}, ${alert.alertType}`);
    const values = [alert.date, alert.ruleId, alert.instrument];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    const typeCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "alert-type-pill";
    pill.dataset.type = alert.alertType;
    pill.textContent = alert.alertType;
    typeCell.append(pill);
    row.append(typeCell);
    const description = document.createElement("td");
    description.textContent = alert.description;
    row.append(description);
    const selectRow = () => {
      state.selectedAlertKey = alertKey(alert);
      renderAlerts();
      renderAlertDetail(alert);
    };
    row.addEventListener("click", selectRow);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectRow();
      }
    });
    body.append(row);
  });
  const hasResult = state.alerts !== null;
  const hasAlerts = hasResult && state.alerts.length > 0;
  byId("results-placeholder").hidden = hasResult;
  byId("no-alerts").hidden = !hasResult || hasAlerts;
  byId("no-matches").hidden = !hasAlerts || rows.length > 0;
  byId("alert-table-wrap").hidden = !hasResult;
  byId("alert-table").hidden = !hasAlerts;
  byId("result-visible-count").textContent = hasAlerts
    ? `Showing ${rows.length} of ${state.alerts.length} alerts` : hasResult ? "0 alerts" : "No result set";
}

function renderAlertDetail(alert) {
  const target = byId("alert-detail");
  target.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "detail-block";
  const event = document.createElement("strong");
  event.className = "detail-event";
  event.textContent = `${alert.alertType} · ${alert.date}`;
  const ruleText = document.createElement("span");
  ruleText.className = "detail-rule";
  ruleText.textContent = `Rule ${alert.ruleId}: ${normalizedRuleLabel(alert.rule)}`;
  const facts = document.createElement("div");
  facts.className = "detail-facts";
  const values = [
    ["Instrument", alert.instrument],
    ["Rule condition", alert.rule.direction
      ? alert.rule.direction.toLowerCase() : "Either crossing (legacy behavior)"]
  ];
  if (alert.rule.type === "LEVEL") {
    values.push(
      ["Previous close", formatDecimal(alert.previous.close)],
      ["Level", formatDecimal(alert.rule.threshold)],
      ["Current close", formatDecimal(alert.current.close)]
    );
  } else {
    values.push(
      ["Moving-average windows", `${alert.rule.shortWindow} / ${alert.rule.longWindow}`],
      ["Observation before event", `${alert.previous.date} · ${formatDecimal(alert.previous.close)}`],
      ["Event observation", `${alert.current.date} · ${formatDecimal(alert.current.close)}`]
    );
  }
  values.forEach(([label, value]) => {
    const term = document.createElement("span");
    const fact = document.createElement("b");
    term.textContent = label;
    fact.textContent = value;
    facts.append(term, fact);
  });
  wrapper.append(event, ruleText, facts);
  if (alert.rule.type === "MA_CROSS") {
    const note = document.createElement("p");
    note.className = "detail-note";
    note.textContent = "The alert output identifies the crossover and its window sizes; it does not include average values.";
    wrapper.append(note);
  }
  target.append(wrapper);
}

function renderBreakdown() {
  const target = byId("type-breakdown");
  target.replaceChildren();
  const counts = new Map();
  (state.alerts || []).forEach((alert) => counts.set(alert.alertType,
    (counts.get(alert.alertType) || 0) + 1));
  if (!counts.size) {
    target.textContent = state.alerts === null ? "No computed alerts yet." : "No alert types to summarize.";
    return;
  }
  const maxCount = Math.max(...counts.values());
  counts.forEach((count, type) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.dataset.type = type;
    const name = document.createElement("span");
    const track = document.createElement("span");
    track.className = "breakdown-track";
    const bar = document.createElement("i");
    bar.style.width = `${(count / maxCount) * 100}%`;
    track.append(bar);
    const amount = document.createElement("b");
    name.textContent = type.replace("_", " ");
    amount.textContent = String(count);
    row.append(name, track, amount);
    target.append(row);
  });
}

function drawLineChart(svg, records, matchingAlerts) {
  const width = 600;
  const height = 190;
  const margin = { left: 45, right: 12, top: 12, bottom: 28 };
  const values = records.map((record) => Number(formatDecimal(record.close)));
  if (values.some((value) => !Number.isFinite(value))) {
    byId("chart-area").textContent = "Values exceed the chart's display range. Alert calculations remain exact.";
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.max(Math.abs(max) * 0.05, 1);
  const x = (index) => margin.left + index * (width - margin.left - margin.right) /
    Math.max(1, records.length - 1);
  const y = (value) => margin.top + (max + spread * 0.08 - value) *
    (height - margin.top - margin.bottom) / (spread * 1.16);
  const namespace = "http://www.w3.org/2000/svg";
  const add = (name, attributes = {}, text = "") => {
    const element = document.createElementNS(namespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text) element.textContent = text;
    svg.append(element);
    return element;
  };
  [0, 1, 2].forEach((step) => {
    const price = max + spread * 0.08 - step * spread * 1.16 / 2;
    const posY = y(price);
    add("line", { x1: margin.left, y1: posY, x2: width - margin.right, y2: posY, class: "chart-gridline" });
    add("text", { x: 1, y: posY + 3 }, price.toPrecision(5));
  });
  const points = records.map((record, index) => `${x(index)},${y(values[index])}`).join(" ");
  add("polyline", { points: `${margin.left},${height - margin.bottom} ${points} ${x(records.length - 1)},${height - margin.bottom}`, class: "chart-area-fill" });
  add("polyline", { points, class: "chart-line" });
  const alertDates = new Set(matchingAlerts.map((alert) => alert.date));
  records.forEach((record, index) => {
    if (index === 0 || index === records.length - 1 ||
        index === Math.floor((records.length - 1) / 2)) {
      add("text", { x: x(index) - 21, y: height - 7 }, record.date.slice(5));
    }
    if (alertDates.has(record.date)) {
      add("circle", { cx: x(index), cy: y(values[index]), r: 5, class: "chart-alert-dot" });
    }
  });
}

function renderChart() {
  const area = byId("chart-area");
  const select = byId("chart-instrument");
  if (!state.prices?.length) {
    select.replaceChildren(new Option("Select instrument", ""));
    select.disabled = true;
    byId("chart-description").textContent = "Choose an instrument after loading price observations.";
    area.innerHTML = '<div class="chart-placeholder">Actual price observations<br>will be charted here</div>';
    return;
  }
  const instruments = [...new Set(state.prices.map((record) => record.instrument))].sort();
  const current = instruments.includes(select.value) ? select.value : instruments[0];
  select.replaceChildren(...instruments.map((name) => new Option(name, name)));
  select.value = current;
  select.disabled = false;
  const records = state.prices.filter((record) => record.instrument === current)
    .slice().sort((left, right) => left.date.localeCompare(right.date));
  const relatedAlerts = (state.alerts || []).filter((alert) => alert.instrument === current);
  byId("chart-description").textContent = `${records.length} chronological observations · ${relatedAlerts.length} alert dates`;
  area.replaceChildren();
  if (records.length < 2) {
    area.innerHTML = '<div class="chart-placeholder">At least two observations<br>are needed to draw a line.</div>';
    return;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 190");
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${current} historical close prices with alert dates marked`);
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = '<linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".20"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>';
  svg.append(defs);
  drawLineChart(svg, records, relatedAlerts);
  area.replaceChildren(svg);
}

function showAnalysis(alerts) {
  state.alerts = alerts;
  state.selectedAlertKey = null;
  const instruments = new Set(state.prices.map((row) => row.instrument));
  byId("overview-alerts").textContent = String(alerts.length);
  byId("overview-state").textContent = "Analysis complete";
  byId("result-alerts").textContent = String(alerts.length);
  byId("result-instruments").textContent = String(instruments.size);
  byId("result-rules").textContent = String(state.rules.length);
  byId("result-range").textContent = instrumentDateRange(state.prices);
  byId("results-caption").textContent = `${state.prices.length} observations evaluated against ${state.rules.length} validated rules.`;
  byId("export-alerts").disabled = false;
  const alertTypes = [...new Set(alerts.map((alert) => alert.alertType))].sort();
  byId("alert-type").replaceChildren(
    new Option("All alert types", ""),
    ...alertTypes.map((type) => new Option(type, type))
  );
  state.type = "";
  byId("alert-type").value = "";
  byId("analysis-message").textContent = alerts.length
    ? `Complete · ${alerts.length} historical ${alerts.length === 1 ? "signal" : "signals"} found.`
    : "Complete · no configured conditions occurred in this historical data.";
  byId("analysis-message").className = "analysis-message success";
  renderAlerts();
  renderBreakdown();
  renderChart();
}

function exportAlerts() {
  if (!state.alerts) return;
  const csv = alertsToCsv(state.alerts);
  const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "price-alerts.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function loadSampleFile(url) {
  return fetch(url, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
    return response.text();
  });
}

async function loadSamples() {
  byId("analysis-message").textContent = "Loading the local example files…";
  byId("analysis-message").className = "analysis-message";
  try {
    const [pricesText, rulesText] = await Promise.all([
      loadSampleFile("./samples/prices.csv"),
      loadSampleFile("./samples/rules.json")
    ]);
    state.prices = parsePrices(pricesText);
    state.rules = parseRules(rulesText);
    setFileError("prices", "");
    setFileError("rules", "");
    setSelectedFile("prices", new File([pricesText], "sample-prices.csv", { type: "text/csv" }));
    setSelectedFile("rules", new File([rulesText], "sample-rules.json", { type: "application/json" }));
    updatePreviews();
    updateOverview();
    clearResults();
    byId("analysis-message").textContent = "Sample data loaded. Run analysis to calculate its alerts.";
    byId("analysis-message").className = "analysis-message";
    byId("analysis").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    byId("analysis-message").textContent = error.message;
    byId("analysis-message").className = "analysis-message error";
  }
}

async function handleFile(kind, file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    clearResults();
    state[kind] = null;
    setSelectedFile(kind, file);
    setFileError(kind, "This file is larger than 5 MB. Choose a smaller file.");
    updatePreviews();
    updateOverview();
    return;
  }
  await readSelectedFile(kind, file);
}

function bindUpload(kind) {
  const { input, zone } = fileInputs[kind];
  input.addEventListener("change", () => handleFile(kind, input.files[0]));
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.add("is-over");
  }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.remove("is-over");
  }));
  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file) handleFile(kind, file);
  });
}

function resetData() {
  for (const kind of ["prices", "rules"]) {
    state[kind] = null;
    state[`${kind}File`] = null;
    fileInputs[kind].input.value = "";
    setSelectedFile(kind, null);
    setFileError(kind, "");
  }
  updatePreviews();
  updateOverview();
  clearResults();
  byId("analysis-message").textContent = "Workspace cleared.";
  byId("analysis-message").className = "analysis-message";
}

function bindControls() {
  document.querySelector(".theme-toggle").addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  byId("load-sample").addEventListener("click", loadSamples);
  byId("reset-data").addEventListener("click", resetData);
  byId("run-analysis").addEventListener("click", () => {
    if (!state.prices || !state.rules) {
      byId("analysis-message").textContent = "Choose a valid prices CSV and rules JSON before running analysis.";
      byId("analysis-message").className = "analysis-message error";
      return;
    }
    byId("run-analysis").disabled = true;
    byId("run-label").textContent = "Analyzing…";
    try {
      const alerts = runAnalysis(state.prices, state.rules);
      showAnalysis(alerts);
      byId("results").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      byId("analysis-message").textContent = error.message;
      byId("analysis-message").className = "analysis-message error";
    } finally {
      byId("run-label").textContent = "Run analysis";
      updatePreviews();
    }
  });
  byId("alert-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderAlerts();
  });
  byId("alert-type").addEventListener("change", (event) => {
    state.type = event.target.value;
    renderAlerts();
  });
  byId("clear-filters").addEventListener("click", () => {
    state.search = "";
    state.type = "";
    byId("alert-search").value = "";
    byId("alert-type").value = "";
    renderAlerts();
  });
  byId("export-alerts").addEventListener("click", exportAlerts);
  byId("chart-instrument").addEventListener("change", renderChart);
  document.querySelectorAll(".sort-button").forEach((button) => button.addEventListener("click", () => {
    const field = button.dataset.sort;
    if (state.sort === field) state.sortDirection *= -1;
    else {
      state.sort = field;
      state.sortDirection = 1;
    }
    renderAlerts();
  }));
  for (const kind of ["prices", "rules"]) bindUpload(kind);
}

initializeTheme();
bindControls();
updatePreviews();
updateOverview();
clearResults();
