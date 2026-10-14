const MAX_ROWS = 100000;
const MAX_DECIMAL_SCALE = 10000;

function fail(message) {
  throw new Error(message);
}

function decimal(value, field = "value") {
  const text = String(value);
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) fail(`${field} must be a valid decimal.`);

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] || "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] || 0);
  const scale = fraction.length - exponent;
  if (!Number.isSafeInteger(exponent) || Math.abs(scale) > MAX_DECIMAL_SCALE) {
    fail(`${field} has an unsupported decimal precision.`);
  }
  let coefficient = sign * BigInt(`${whole}${fraction}`);
  let normalizedScale = scale;
  if (normalizedScale < 0) {
    coefficient *= 10n ** BigInt(-normalizedScale);
    normalizedScale = 0;
  }
  const display = formatDecimalParts(coefficient, normalizedScale);
  while (normalizedScale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    normalizedScale -= 1;
  }
  return { coefficient, scale: normalizedScale, display };
}

function alignDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale
  ];
}

function compareDecimal(left, right) {
  const [a, b] = alignDecimals(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function addDecimal(left, right) {
  const [a, b, scale] = alignDecimals(left, right);
  return decimalFromParts(a + b, scale);
}

function subtractDecimal(left, right) {
  const [a, b, scale] = alignDecimals(left, right);
  return decimalFromParts(a - b, scale);
}

function decimalFromParts(coefficient, scale) {
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function multiplyInteger(value, integer) {
  return { coefficient: value.coefficient * BigInt(integer), scale: value.scale };
}

export function formatDecimal(value) {
  return value.display ?? formatDecimalParts(value.coefficient, value.scale);
}

function formatDecimalParts(coefficient, scale) {
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, "0");
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return `${negative ? "-" : ""}${digits}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scanJson(text) {
  let index = 0;
  const rootNumbers = [];

  const skipSpace = () => {
    while (/\s/.test(text[index] || "")) index += 1;
  };

  const readString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
      } else if (text[index++] === '"') {
        return JSON.parse(text.slice(start, index));
      }
    }
    fail("Rules JSON contains an unterminated string.");
  };

  const readValue = (rootRuleIndex = null, captureNumbers = false) => {
    skipSpace();
    if (text[index] === "{") {
      index += 1;
      const keys = new Set();
      skipSpace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipSpace();
        if (text[index] !== '"') fail("Rules JSON contains an invalid object.");
        const key = readString();
        if (keys.has(key)) fail(`Rules JSON contains duplicate field '${key}'.`);
        keys.add(key);
        skipSpace();
        index += 1;
        skipSpace();
        if (captureNumbers && text[index] !== "{" && text[index] !== "[") {
          const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
          if (number) {
            rootNumbers[rootRuleIndex] ??= {};
            rootNumbers[rootRuleIndex][key] = number[0];
          }
        }
        readValue();
        skipSpace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        index += 1;
      }
    } else if (text[index] === "[") {
      index += 1;
      skipSpace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      let childIndex = 0;
      while (index < text.length) {
        readValue(rootRuleIndex === null ? childIndex : null,
          rootRuleIndex === null && isRootArray);
        childIndex += 1;
        skipSpace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        index += 1;
      }
    } else if (text[index] === '"') {
      readString();
    } else {
      const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
      if (!primitive) fail("Rules JSON contains an invalid value.");
      index += primitive[0].length;
    }
  };

  const isRootArray = text.trimStart().startsWith("[");
  readValue();
  return rootNumbers;
}

export function parseRules(text) {
  if (text.length > 5 * 1024 * 1024) fail("Rules JSON exceeds the 5 MB file limit.");
  let parsed;
  let numericTokens;
  const jsonText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    parsed = JSON.parse(jsonText);
    numericTokens = scanJson(jsonText);
  } catch (error) {
    if (error instanceof SyntaxError) fail(`Invalid rules JSON: ${error.message}`);
    throw error;
  }
  if (!Array.isArray(parsed)) fail("Rules JSON must contain a JSON array.");

  const ids = new Set();
  return parsed.map((item, index) => {
    const context = `Rule at array index ${index}: `;
    if (!isObject(item)) fail(`${context}expected a JSON object.`);
    for (const field of Object.keys(item)) {
      if (!["id", "instrument", "type", "direction", "level", "threshold",
        "short", "long", "shortWindow", "longWindow"].includes(field)) {
        fail(`${context}unsupported field '${field}'.`);
      }
    }
    if (typeof item.id !== "string" || !item.id.trim()) {
      fail(`${context}field 'id' is required and must be a non-blank string.`);
    }
    if (typeof item.instrument !== "string" || !item.instrument.trim()) {
      fail(`${context}field 'instrument' is required and must be a non-blank string.`);
    }
    const type = typeof item.type === "string" ? item.type.toUpperCase() : "";
    if (!["LEVEL", "MA_CROSS"].includes(type)) {
      fail(`${context}unsupported rule type '${item.type}'; expected LEVEL or MA_CROSS.`);
    }
    if (ids.has(item.id)) fail(`${context}duplicate alert rule id: ${item.id}.`);
    ids.add(item.id);

    let direction = null;
    if (Object.hasOwn(item, "direction")) {
      if (typeof item.direction !== "string" ||
          !["above", "below"].includes(item.direction.toLowerCase())) {
        fail(`${context}invalid direction '${item.direction}'; expected above or below.`);
      }
      direction = item.direction.toUpperCase();
    }
    const raw = numericTokens[index] || {};
    const pickDecimal = (official, legacy) => {
      const hasOfficial = Object.hasOwn(item, official);
      const hasLegacy = Object.hasOwn(item, legacy);
      if (!hasOfficial && !hasLegacy) {
        fail(`${context}field '${official}' (or legacy field '${legacy}') is required and must be numeric.`);
      }
      const officialValue = hasOfficial
        ? decimal(raw[official] ?? String(item[official]), official) : null;
      const legacyValue = hasLegacy
        ? decimal(raw[legacy] ?? String(item[legacy]), legacy) : null;
      if (officialValue && legacyValue && compareDecimal(officialValue, legacyValue) !== 0) {
        fail(`${context}conflicting fields '${official}' and '${legacy}' must have the same value.`);
      }
      return officialValue || legacyValue;
    };
    const pickInteger = (official, legacy) => {
      const hasOfficial = Object.hasOwn(item, official);
      const hasLegacy = Object.hasOwn(item, legacy);
      if (!hasOfficial && !hasLegacy) {
        fail(`${context}field '${official}' (or legacy field '${legacy}') is required and must be an integer.`);
      }
      const parseInteger = (key) => {
        const token = raw[key] ?? String(item[key]);
        if (!/^-?(?:0|[1-9]\d*)$/.test(token)) {
          fail(`${context}field '${key}' must be an integer within the supported range.`);
        }
        const exact = BigInt(token);
        if (exact < -2147483648n || exact > 2147483647n) {
          fail(`${context}field '${key}' must be an integer within the supported range.`);
        }
        return Number(exact);
      };
      const a = hasOfficial ? parseInteger(official) : null;
      const b = hasLegacy ? parseInteger(legacy) : null;
      if (a !== null && b !== null && a !== b) {
        fail(`${context}conflicting fields '${official}' and '${legacy}' must have the same value.`);
      }
      return a ?? b;
    };

    if (type === "LEVEL") {
      if (["short", "long", "shortWindow", "longWindow"].some((key) => Object.hasOwn(item, key))) {
        fail(`${context}LEVEL rules must not specify moving-average windows.`);
      }
      return { id: item.id, instrument: item.instrument, type, direction,
        threshold: pickDecimal("level", "threshold") };
    }
    if (Object.hasOwn(item, "level") || Object.hasOwn(item, "threshold")) {
      fail(`${context}MA_CROSS rules must not specify a threshold.`);
    }
    const shortWindow = pickInteger("short", "shortWindow");
    const longWindow = pickInteger("long", "longWindow");
    if (shortWindow <= 0) fail(`${context}shortWindow must be positive.`);
    if (longWindow <= 0) fail(`${context}longWindow must be positive.`);
    if (shortWindow >= longWindow) {
      fail(`${context}shortWindow must be less than longWindow.`);
    }
    return { id: item.id, instrument: item.instrument, type, direction,
      shortWindow, longWindow };
  });
}

function parseCsvRows(text) {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) fail("Malformed CSV: quoted field was not closed.");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parsePrices(text) {
  if (text.length > 5 * 1024 * 1024) fail("Prices CSV exceeds the 5 MB file limit.");
  const rows = parseCsvRows(text);
  const header = rows.shift();
  if (!header) fail("Prices CSV is empty; include the date,instrument,close header row.");
  if (new Set(header).size !== header.length) fail("Prices CSV contains duplicate headers.");
  const columns = new Map(header.map((name, index) => [name, index]));
  const missing = ["date", "instrument", "close"].filter((name) => !columns.has(name));
  if (missing.length) fail(`Prices CSV is missing required headers: ${missing.join(", ")}.`);
  const result = [];
  for (const [rowIndex, values] of rows.entries()) {
    if (result.length >= MAX_ROWS) fail(`Prices CSV exceeds the ${MAX_ROWS} observation limit.`);
    if (values.length !== header.length) {
      fail(`CSV record ${rowIndex + 1}: expected ${header.length} columns but found ${values.length}.`);
    }
    const date = values[columns.get("date")];
    const instrument = values[columns.get("instrument")];
    const closeText = values[columns.get("close")];
    if (!date.trim()) fail(`CSV record ${rowIndex + 1}: required field 'date' is blank.`);
    if (!instrument.trim()) fail(`CSV record ${rowIndex + 1}: required field 'instrument' is blank.`);
    if (!closeText.trim()) fail(`CSV record ${rowIndex + 1}: required field 'close' is blank.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      fail(`CSV record ${rowIndex + 1}: field 'date' must use ISO format YYYY-MM-DD: ${date}`);
    }
    const dateObject = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(dateObject.valueOf()) || dateObject.toISOString().slice(0, 10) !== date) {
      fail(`CSV record ${rowIndex + 1}: field 'date' must use ISO format YYYY-MM-DD: ${date}`);
    }
    const close = decimal(closeText, `CSV record ${rowIndex + 1}: field 'close'`);
    if (close.coefficient <= 0n) fail(`CSV record ${rowIndex + 1}: close must be positive.`);
    result.push({ date, instrument, close, closeText });
  }
  return result;
}

export function runAnalysis(prices, rules) {
  const observationKeys = new Set();
  for (const record of prices) {
    const key = `${record.instrument}\u0000${record.date}`;
    if (observationKeys.has(key)) {
      fail(`duplicate price observation for instrument ${record.instrument} on ${record.date}`);
    }
    observationKeys.add(key);
  }
  const ruleIds = new Set();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) fail(`duplicate alert rule id: ${rule.id}`);
    ruleIds.add(rule.id);
  }

  const alerts = [];
  for (const rule of rules) {
    const records = prices.filter((record) => record.instrument === rule.instrument)
      .slice().sort((left, right) => left.date.localeCompare(right.date));
    if (rule.type === "LEVEL") {
      for (let index = 1; index < records.length; index += 1) {
        const previous = records[index - 1];
        const current = records[index];
        const previousComparison = compareDecimal(previous.close, rule.threshold);
        const currentComparison = compareDecimal(current.close, rule.threshold);
        if (previousComparison <= 0 && currentComparison > 0 &&
            (!rule.direction || rule.direction === "ABOVE")) {
          alerts.push({
            date: current.date, ruleId: rule.id, instrument: rule.instrument,
            alertType: "LEVEL_UP",
            description: `${rule.instrument} crossed above ${formatDecimal(rule.threshold)} (from ${formatDecimal(previous.close)} to ${formatDecimal(current.close)})`,
            rule, previous, current
          });
        } else if (previousComparison >= 0 && currentComparison < 0 &&
            (!rule.direction || rule.direction === "BELOW")) {
          alerts.push({
            date: current.date, ruleId: rule.id, instrument: rule.instrument,
            alertType: "LEVEL_DOWN",
            description: `${rule.instrument} crossed below ${formatDecimal(rule.threshold)} (from ${formatDecimal(previous.close)} to ${formatDecimal(current.close)})`,
            rule, previous, current
          });
        }
      }
      continue;
    }

    let shortSum = decimal("0");
    let longSum = decimal("0");
    let previousComparison = null;
    for (let index = 0; index < records.length; index += 1) {
      const close = records[index].close;
      shortSum = addDecimal(shortSum, close);
      longSum = addDecimal(longSum, close);
      if (index >= rule.shortWindow) {
        shortSum = subtractDecimal(shortSum, records[index - rule.shortWindow].close);
      }
      if (index >= rule.longWindow) {
        longSum = subtractDecimal(longSum, records[index - rule.longWindow].close);
      }
      if (index < rule.longWindow - 1) continue;
      const currentComparison = compareDecimal(
        multiplyInteger(shortSum, rule.longWindow),
        multiplyInteger(longSum, rule.shortWindow)
      );
      if (previousComparison !== null && previousComparison <= 0 && currentComparison > 0 &&
          (!rule.direction || rule.direction === "ABOVE")) {
        const previous = records[index - 1];
        const current = records[index];
        alerts.push({
          date: current.date, ruleId: rule.id, instrument: rule.instrument,
          alertType: "MA_BULLISH",
          description: `${rule.instrument} short moving average crossed above long moving average for windows ${rule.shortWindow}/${rule.longWindow}`,
          rule, previous, current
        });
      } else if (previousComparison !== null && previousComparison >= 0 && currentComparison < 0 &&
          (!rule.direction || rule.direction === "BELOW")) {
        const previous = records[index - 1];
        const current = records[index];
        alerts.push({
          date: current.date, ruleId: rule.id, instrument: rule.instrument,
          alertType: "MA_BEARISH",
          description: `${rule.instrument} short moving average crossed below long moving average for windows ${rule.shortWindow}/${rule.longWindow}`,
          rule, previous, current
        });
      }
      previousComparison = currentComparison;
    }
  }
  alerts.sort((left, right) => left.date.localeCompare(right.date) ||
    left.ruleId.localeCompare(right.ruleId));
  return alerts;
}

export function normalizedRuleLabel(rule) {
  return rule.type === "LEVEL"
    ? `${rule.instrument} ${rule.direction ? rule.direction.toLowerCase() : "either direction"} ${formatDecimal(rule.threshold)}`
    : `${rule.instrument} ${rule.shortWindow}/${rule.longWindow} MA ${rule.direction ? rule.direction.toLowerCase() : "either direction"}`;
}
