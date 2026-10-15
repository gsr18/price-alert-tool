import { formatDecimal } from "./engine.js";

export function rulesToJson(rules) {
  const definitions = rules.map((rule) => {
    const fields = [
      `    "id": ${JSON.stringify(rule.id)}`,
      `    "instrument": ${JSON.stringify(rule.instrument)}`,
      `    "type": ${JSON.stringify(rule.type.toLowerCase())}`
    ];
    if (rule.direction) fields.push(`    "direction": ${JSON.stringify(rule.direction.toLowerCase())}`);
    if (rule.type === "LEVEL") {
      fields.push(`    "level": ${formatDecimal(rule.threshold)}`);
    } else {
      fields.push(`    "short": ${rule.shortWindow}`, `    "long": ${rule.longWindow}`);
    }
    return `  {\n${fields.join(",\n")}\n  }`;
  });
  return `[\n${definitions.join(",\n")}\n]\n`;
}
