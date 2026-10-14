export function alertsToCsv(alerts) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [
    ["date", "ruleId", "instrument", "alertType", "description"],
    ...alerts.map((alert) => [
      alert.date, alert.ruleId, alert.instrument, alert.alertType, alert.description
    ])
  ];
  return rows.map((row) => row.map(quote).join(",")).join("\r\n");
}
