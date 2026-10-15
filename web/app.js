import {
  formatDecimal,
  normalizedRuleLabel,
  parsePrices,
  parseRules,
  runAnalysis
} from "./engine.js";
import { alertsToCsv } from "./export.js";
import { rulesToJson } from "./rule-format.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const state = {
  prices: null,
  rules: null,
  pricesFile: null,
  rulesFile: null,
  pricesText: "",
  rulesText: "",
  alerts: null,
  selectedAlertKey: null,
  search: "",
  instrument: "",
  type: "",
  dateFrom: "",
  dateTo: "",
  sort: "date",
  sortDirection: 1,
  mode: "user"
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
  byId("copy-alert").disabled = true;
  byId("type-breakdown").textContent = "No computed alerts yet.";
  byId("alert-detail").textContent = "Select an alert row to inspect the rule and observed values.";
  byId("alert-instrument").replaceChildren(new Option("All instruments", ""));
  byId("alert-type").replaceChildren(new Option("All types", ""));
  byId("chart-point-detail").textContent = "Select a chart point to inspect its date and close.";
  renderChart();
}

function updateOverview() {
  const instruments = new Set((state.prices || []).map((row) => row.instrument));
  byId("overview-instruments").textContent = String(instruments.size);
  byId("overview-observations").textContent = String(state.prices?.length || 0);
  byId("overview-rules").textContent = String(state.rules?.length || 0);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function pricesToCsv(prices) {
  return ["date,instrument,close", ...prices.map((record) =>
    [record.date, record.instrument, formatDecimal(record.close)].map(csvCell).join(","))]
    .join("\r\n");
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function applyRulesText(text) {
  const rules = parseRules(text);
  state.rules = rules;
  state.rulesText = text;
  state.rulesFile = new File([text], "edited-rules.json", { type: "application/json" });
  fileInputs.rules.input.value = "";
  setSelectedFile("rules", state.rulesFile);
  byId("raw-rules").value = text;
  setFileError("rules", "");
  byId("raw-rules-error").textContent = "";
  updatePreviews();
  updateOverview();
  renderRuleManager();
  clearResults();
  byId("analysis-message").textContent = "Rules validated and applied. Run analysis to compute results.";
  byId("analysis-message").className = "analysis-message";
}

function renderRuleManager() {
  const cards = byId("rule-cards");
  cards.replaceChildren();
  const rules = state.rules || [];
  byId("rules-empty").hidden = rules.length > 0;
  rules.forEach((rule) => {
    const card = document.createElement("article");
    card.className = "panel rule-card";
    const head = document.createElement("div");
    head.className = "rule-card-head";
    const title = document.createElement("h3");
    title.textContent = rule.id;
    const kind = document.createElement("span");
    kind.className = "alert-type-pill";
    kind.textContent = rule.type === "LEVEL" ? "LEVEL" : "MA_CROSS";
    head.append(title, kind);
    const definition = document.createElement("p");
    definition.textContent = normalizedRuleLabel(rule);
    const actions = document.createElement("div");
    actions.className = "rule-card-actions";
    for (const [action, label] of [["edit", "Edit"], ["duplicate", "Duplicate"], ["delete", "Delete"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "delete" ? "button button-quiet" : "button button-secondary";
      button.dataset.ruleAction = action;
      button.dataset.ruleId = rule.id;
      button.textContent = label;
      actions.append(button);
    }
    card.append(head, definition, actions);
    cards.append(card);
  });
}

function openRuleDialog(rule = null, duplicate = false) {
  const dialog = byId("rule-dialog");
  const form = byId("rule-form");
  form.reset();
  form.elements.originalId.value = rule && !duplicate ? rule.id : "";
  form.elements.id.value = rule ? rule.id : "";
  if (duplicate && rule) {
    const base = `${rule.id}-copy`;
    let candidate = base;
    let index = 2;
    while ((state.rules || []).some((entry) => entry.id === candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    form.elements.id.value = candidate;
  }
  form.elements.instrument.value = rule ? rule.instrument : "";
  form.elements.type.value = rule ? rule.type : "LEVEL";
  form.elements.direction.value = rule?.direction?.toLowerCase() || "";
  form.elements.level.value = rule?.type === "LEVEL" ? formatDecimal(rule.threshold) : "";
  form.elements.short.value = rule?.type === "MA_CROSS" ? rule.shortWindow : "";
  form.elements.long.value = rule?.type === "MA_CROSS" ? rule.longWindow : "";
  byId("rule-dialog-title").textContent = rule && !duplicate ? "Edit alert rule"
    : duplicate ? "Duplicate alert rule" : "Create alert rule";
  byId("rule-form-error").textContent = "";
  updateRuleFields();
  dialog.showModal();
  form.elements.id.focus();
}

function updateRuleFields() {
  const isLevel = byId("rule-form").elements.type.value === "LEVEL";
  document.querySelector(".level-fields").hidden = !isLevel;
  document.querySelector(".ma-fields").hidden = isLevel;
  byId("rule-form").elements.level.required = isLevel;
  byId("rule-form").elements.short.required = !isLevel;
  byId("rule-form").elements.long.required = !isLevel;
}

function saveRuleFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value.trim();
  const originalId = form.elements.originalId.value;
  try {
    const type = form.elements.type.value;
    const fields = [
      `"id":${JSON.stringify(id)}`,
      `"instrument":${JSON.stringify(form.elements.instrument.value.trim())}`,
      `"type":${JSON.stringify(type.toLowerCase())}`
    ];
    if (form.elements.direction.value) {
      fields.push(`"direction":${JSON.stringify(form.elements.direction.value)}`);
    }
    if (type === "LEVEL") fields.push(`"level":${form.elements.level.value}`);
    else fields.push(`"short":${form.elements.short.value}`, `"long":${form.elements.long.value}`);
    const newRule = parseRules(`[{${fields.join(",")}}]`)[0];
    const edited = [...(state.rules || [])];
    const oldIndex = originalId ? edited.findIndex((rule) => rule.id === originalId) : -1;
    if (oldIndex >= 0) edited.splice(oldIndex, 1, newRule);
    else edited.push(newRule);
    applyRulesText(rulesToJson(edited));
    byId("rule-dialog").close();
  } catch (error) {
    byId("rule-form-error").textContent = error.message;
  }
}

function handleRuleAction(event) {
  const button = event.target.closest("[data-rule-action]");
  if (!button) return;
  const rule = (state.rules || []).find((entry) => entry.id === button.dataset.ruleId);
  if (!rule) return;
  if (button.dataset.ruleAction === "edit") openRuleDialog(rule);
  else if (button.dataset.ruleAction === "duplicate") openRuleDialog(rule, true);
  else if (window.confirm(`Delete rule "${rule.id}"?`)) {
    applyRulesText(rulesToJson((state.rules || []).filter((entry) => entry.id !== rule.id)));
  }
}

function renderObservationList() {
  const list = byId("observation-list");
  list.replaceChildren();
  const records = state.prices || [];
  const visible = records.slice(-12).reverse();
  visible.forEach((record) => {
    const item = document.createElement("div");
    item.className = "observation-item";
    const text = document.createElement("span");
    text.textContent = `${record.date} · ${record.instrument} · ${formatDecimal(record.close)}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${record.instrument} observation on ${record.date}`);
    remove.addEventListener("click", () => {
      replacePrices(records.filter((entry) =>
        !(entry.date === record.date && entry.instrument === record.instrument)));
    });
    item.append(text, remove);
    list.append(item);
  });
}

function replacePrices(records) {
  try {
    const text = pricesToCsv(records);
    state.prices = parsePrices(text);
    state.pricesText = text;
    state.pricesFile = new File([text], "edited-prices.csv", { type: "text/csv" });
    fileInputs.prices.input.value = "";
    setSelectedFile("prices", state.pricesFile);
    updatePreviews();
    updateOverview();
    renderObservationList();
    updateAdvancedPreview();
    clearResults();
    byId("analysis-message").textContent = "Price observations updated. Run analysis to recompute results.";
    byId("analysis-message").className = "analysis-message";
  } catch (error) {
    byId("analysis-message").textContent = error.message;
    byId("analysis-message").className = "analysis-message error";
  }
}

function updateAdvancedPreview() {
  byId("raw-csv-preview").value = state.pricesText || "No prices loaded.";
  if (!byId("raw-rules").value && state.rulesText) byId("raw-rules").value = state.rulesText;
}

function setMode(mode) {
  state.mode = mode;
  document.documentElement.dataset.mode = mode;
  const button = byId("mode-toggle");
  button.textContent = mode === "admin" ? "Admin mode" : "User mode";
  button.setAttribute("aria-pressed", String(mode === "admin"));
  button.title = mode === "admin"
    ? "Admin mode reveals advanced local tools; it is not a security boundary."
    : "Switch to local advanced-workspace mode.";
}

const pageDescriptions = {
  overview: ["Overview", "Load historical observations and transparent rules to find verifiable signals."],
  data: ["Data / Inputs", "Select, inspect, and edit the price observations and rules for analysis."],
  rules: ["Rules", "Create, duplicate, edit, or remove historical alert conditions."],
  analysis: ["Analysis / Results", "Run the local engine, filter computed alerts, and inspect the source observations."],
  about: ["About / Help", "Understand the local browser implementation, limitations, and historical-alert disclaimer."]
};

function updateNavigation() {
  const section = location.hash.slice(1) in pageDescriptions ? location.hash.slice(1) : "overview";
  const [title, description] = pageDescriptions[section];
  byId("page-title").textContent = title;
  byId("page-description").textContent = description;
  document.title = `${title} · Price Alert Studio`;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
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
  name.title = file.name;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${file.name}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => {
    fileInputs[kind].input.value = "";
    state[kind] = null;
    state[`${kind}Text`] = "";
    setSelectedFile(kind, null);
    setFileError(kind, "");
    updatePreviews();
    updateOverview();
    renderRuleManager();
    renderObservationList();
    updateAdvancedPreview();
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
      state[`${kind}Text`] = text;
      state[kind] = kind === "prices" ? parsePrices(text) : parseRules(text);
      if (kind === "rules") byId("raw-rules").value = text;
      byId("analysis-message").textContent = "";
      byId("analysis-message").className = "analysis-message";
    } catch (error) {
      setFileError(kind, error.message);
    }
  }
  updatePreviews();
  updateOverview();
  renderRuleManager();
  renderObservationList();
  updateAdvancedPreview();
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
  byId("download-rules").disabled = state.rules === null;
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
      alert.ruleId.toLocaleLowerCase().includes(search) ||
      alert.description.toLocaleLowerCase().includes(search)) &&
    (!state.type || alert.alertType === state.type) &&
    (!state.instrument || alert.instrument === state.instrument) &&
    (!state.dateFrom || alert.date >= state.dateFrom) &&
    (!state.dateTo || alert.date <= state.dateTo)
  );
}

function compareDisplayText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function renderAlerts() {
  const body = byId("alert-rows");
  body.replaceChildren();
  const rows = filteredAlerts();
  if (state.sort !== "date") {
    rows.sort((left, right) =>
      compareDisplayText(String(left[state.sort]), String(right[state.sort])) * state.sortDirection ||
      compareDisplayText(left.date, right.date) || compareDisplayText(left.ruleId, right.ruleId)
    );
  } else if (state.sortDirection < 0) {
    rows.reverse();
  }
  const originalRows = [...rows];
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
  const hasMatches = rows.length > 0;
  if (state.selectedAlertKey && !rows.some((alert) => alertKey(alert) === state.selectedAlertKey)) {
    state.selectedAlertKey = null;
    byId("alert-detail").textContent = hasResult && hasAlerts
      ? "The selected alert is hidden by the current filters."
      : "Select a result row to inspect its rule and observations.";
    byId("copy-alert").disabled = true;
  }
  byId("results-placeholder").hidden = hasResult;
  byId("no-alerts").hidden = !hasResult || hasAlerts;
  byId("no-matches").hidden = !hasAlerts || hasMatches;
  byId("alert-table-wrap").hidden = !hasResult;
  byId("alert-table").hidden = !hasMatches;
  byId("result-visible-count").textContent = hasAlerts
    ? `Showing ${originalRows.length} of ${state.alerts.length} alerts` : hasResult ? "0 alerts" : "No result set";
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
  byId("copy-alert").disabled = false;
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
    const isAlertDate = alertDates.has(record.date);
    const marker = add("circle", {
      cx: x(index), cy: y(values[index]), r: isAlertDate ? 5 : 3,
      class: isAlertDate ? "chart-alert-dot" : "chart-point",
      tabindex: 0, role: "button",
      "aria-label": `${record.date}, close ${formatDecimal(record.close)}${isAlertDate ? ", alert date" : ""}`
    });
    const showPoint = () => {
      byId("chart-point-detail").textContent =
        `${record.date} · ${record.instrument} · close ${formatDecimal(record.close)}${isAlertDate ? " · alert triggered" : ""}`;
    };
    marker.addEventListener("click", showPoint);
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showPoint();
      }
    });
    const title = document.createElementNS(namespace, "title");
    title.textContent = `${record.date}: ${formatDecimal(record.close)}${isAlertDate ? " (alert date)" : ""}`;
    marker.append(title);
  });
}

function renderChart() {
  const area = byId("chart-area");
  const select = byId("chart-instrument");
  if (!state.prices?.length) {
    select.replaceChildren(new Option("Select instrument", ""));
    select.disabled = true;
    byId("chart-description").textContent = "Choose an instrument after loading price observations.";
    const placeholder = document.createElement("div");
    placeholder.className = "chart-placeholder";
    placeholder.textContent = "Historical closes will appear here.";
    area.replaceChildren(placeholder);
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
    const placeholder = document.createElement("div");
    placeholder.className = "chart-placeholder";
    placeholder.textContent = "At least two observations are needed to draw a line.";
    area.replaceChildren(placeholder);
    return;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 190");
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${current} historical close prices with alert dates marked`);
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.id = "chartFill";
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("y2", "1");
  [["0%", ".20"], ["100%", "0"]].forEach(([offset, opacity]) => {
    const stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", "var(--accent)");
    stop.setAttribute("stop-opacity", opacity);
    gradient.append(stop);
  });
  defs.append(gradient);
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
  const alertInstruments = [...new Set(alerts.map((alert) => alert.instrument))].sort();
  byId("alert-instrument").replaceChildren(
    new Option("All instruments", ""),
    ...alertInstruments.map((instrument) => new Option(instrument, instrument))
  );
  byId("alert-type").replaceChildren(
    new Option("All alert types", ""),
    ...alertTypes.map((type) => new Option(type, type))
  );
  state.type = "";
  state.instrument = "";
  state.dateFrom = "";
  state.dateTo = "";
  byId("alert-instrument").value = "";
  byId("alert-type").value = "";
  byId("alert-date-from").value = "";
  byId("alert-date-to").value = "";
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
    state.pricesText = pricesText;
    state.rulesText = rulesText;
    byId("raw-rules").value = rulesText;
    setFileError("prices", "");
    setFileError("rules", "");
    setSelectedFile("prices", new File([pricesText], "sample-prices.csv", { type: "text/csv" }));
    setSelectedFile("rules", new File([rulesText], "sample-rules.json", { type: "application/json" }));
    updatePreviews();
    updateOverview();
    renderRuleManager();
    renderObservationList();
    updateAdvancedPreview();
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
    state[`${kind}Text`] = "";
    setSelectedFile(kind, file);
    setFileError(kind, "This file is larger than 5 MB. Choose a smaller file.");
    updatePreviews();
    updateOverview();
    renderRuleManager();
    renderObservationList();
    updateAdvancedPreview();
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
  if (!window.confirm("Reset all loaded files, rules, observations, and results?")) return;
  for (const kind of ["prices", "rules"]) {
    state[kind] = null;
    state[`${kind}Text`] = "";
    state[`${kind}File`] = null;
    fileInputs[kind].input.value = "";
    setSelectedFile(kind, null);
    setFileError(kind, "");
  }
  updatePreviews();
  updateOverview();
  byId("raw-rules").value = "";
  byId("raw-rules-error").textContent = "";
  renderRuleManager();
  renderObservationList();
  updateAdvancedPreview();
  clearResults();
  byId("analysis-message").textContent = "Workspace cleared.";
  byId("analysis-message").className = "analysis-message";
}

function addObservation(event) {
  event.preventDefault();
  if (!state.prices) {
    byId("analysis-message").textContent = "Load a valid prices CSV before adding an observation.";
    byId("analysis-message").className = "analysis-message error";
    return;
  }
  const form = event.currentTarget;
  const values = new FormData(form);
  const nextCsv = `${pricesToCsv(state.prices)}\r\n${[
    values.get("date"), values.get("instrument"), values.get("close")
  ].map(csvCell).join(",")}`;
  try {
    replacePrices(parsePrices(nextCsv));
    form.reset();
  } catch (error) {
    byId("analysis-message").textContent = error.message;
    byId("analysis-message").className = "analysis-message error";
  }
}

function downloadRules() {
  if (!state.rules) return;
  downloadText("price-alert-rules.json", rulesToJson(state.rules), "application/json;charset=utf-8");
}

function downloadDiagnostics() {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: state.mode,
    input: {
      pricesFile: state.pricesFile?.name || null,
      rulesFile: state.rulesFile?.name || null,
      validPriceObservations: state.prices?.length ?? null,
      validRules: state.rules?.length ?? null,
      priceError: byId("prices-error").textContent || null,
      rulesError: byId("rules-error").textContent || null,
      analysisError: byId("analysis-message").classList.contains("error")
        ? byId("analysis-message").textContent : null
    },
    results: state.alerts === null ? null : {
      alertCount: state.alerts.length,
      alerts: state.alerts.map(({ date, ruleId, instrument, alertType, description }) =>
        ({ date, ruleId, instrument, alertType, description }))
    },
    browserLimits: {
      maxFileBytes: MAX_FILE_BYTES,
      maxPriceRows: 100000,
      maxDecimalScale: 10000
    }
  };
  downloadText("price-alert-diagnostics.json", JSON.stringify(report, null, 2),
    "application/json;charset=utf-8");
}

async function copySelectedAlert() {
  const alert = state.alerts?.find((entry) => alertKey(entry) === state.selectedAlertKey);
  if (!alert) return;
  const summary = [
    `${alert.alertType} · ${alert.date}`,
    `Rule ${alert.ruleId} · ${alert.instrument}`,
    alert.description,
    alert.rule.type === "LEVEL"
      ? `Previous ${formatDecimal(alert.previous.close)} · Level ${formatDecimal(alert.rule.threshold)} · Current ${formatDecimal(alert.current.close)}`
      : `Adjacent observations: ${alert.previous.date} ${formatDecimal(alert.previous.close)} → ${alert.current.date} ${formatDecimal(alert.current.close)}`
  ].join("\n");
  try {
    await navigator.clipboard.writeText(summary);
    byId("analysis-message").textContent = "Selected alert details copied.";
    byId("analysis-message").className = "analysis-message success";
  } catch {
    byId("analysis-message").textContent = "Clipboard access is unavailable. Select the alert details and copy them manually.";
    byId("analysis-message").className = "analysis-message error";
  }
}

function bindControls() {
  document.querySelector(".theme-toggle").addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  byId("load-sample").addEventListener("click", loadSamples);
  byId("reset-data").addEventListener("click", resetData);
  byId("mode-toggle").addEventListener("click", () =>
    setMode(state.mode === "user" ? "admin" : "user"));
  byId("create-rule").addEventListener("click", () => openRuleDialog());
  document.querySelector("[data-create-rule]").addEventListener("click", () => openRuleDialog());
  byId("rule-cards").addEventListener("click", handleRuleAction);
  byId("rule-form").addEventListener("submit", saveRuleFromForm);
  byId("rule-form").elements.type.addEventListener("change", updateRuleFields);
  byId("close-rule-dialog").addEventListener("click", () => byId("rule-dialog").close());
  byId("cancel-rule").addEventListener("click", () => byId("rule-dialog").close());
  byId("observation-form").addEventListener("submit", addObservation);
  byId("download-rules").addEventListener("click", downloadRules);
  byId("apply-raw-rules").addEventListener("click", () => {
    try {
      applyRulesText(byId("raw-rules").value);
    } catch (error) {
      byId("raw-rules-error").textContent = error.message;
    }
  });
  byId("reset-raw-rules").addEventListener("click", () => {
    byId("raw-rules").value = state.rulesText;
    byId("raw-rules-error").textContent = "";
  });
  byId("download-diagnostics").addEventListener("click", downloadDiagnostics);
  byId("copy-alert").addEventListener("click", copySelectedAlert);
  window.addEventListener("hashchange", updateNavigation);
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
  byId("alert-instrument").addEventListener("change", (event) => {
    state.instrument = event.target.value;
    renderAlerts();
  });
  byId("alert-date-from").addEventListener("change", (event) => {
    state.dateFrom = event.target.value;
    renderAlerts();
  });
  byId("alert-date-to").addEventListener("change", (event) => {
    state.dateTo = event.target.value;
    renderAlerts();
  });
  byId("clear-filters").addEventListener("click", () => {
    state.search = "";
    state.instrument = "";
    state.type = "";
    state.dateFrom = "";
    state.dateTo = "";
    byId("alert-search").value = "";
    byId("alert-instrument").value = "";
    byId("alert-type").value = "";
    byId("alert-date-from").value = "";
    byId("alert-date-to").value = "";
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
setMode("user");
bindControls();
updatePreviews();
updateOverview();
renderRuleManager();
renderObservationList();
updateAdvancedPreview();
updateNavigation();
clearResults();
