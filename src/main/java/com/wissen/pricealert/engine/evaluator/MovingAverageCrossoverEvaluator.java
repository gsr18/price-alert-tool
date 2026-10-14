package com.wissen.pricealert.engine.evaluator;

import com.wissen.pricealert.domain.Alert;
import com.wissen.pricealert.domain.AlertRule;
import com.wissen.pricealert.domain.PriceRecord;
import com.wissen.pricealert.domain.RuleDirection;
import com.wissen.pricealert.domain.RuleType;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

public final class MovingAverageCrossoverEvaluator {

    public List<Alert> evaluate(List<PriceRecord> records, AlertRule rule) {
        Objects.requireNonNull(records, "records must not be null");
        Objects.requireNonNull(rule, "rule must not be null");
        if (rule.type() != RuleType.MA_CROSS) {
            throw new IllegalArgumentException("rule must have type MA_CROSS");
        }

        List<PriceRecord> orderedRecords = records.stream()
                .map(record -> Objects.requireNonNull(record, "records must not contain null"))
                .filter(record -> record.instrument().equals(rule.instrument()))
                .sorted(Comparator.comparing(PriceRecord::date))
                .toList();
        rejectDuplicateDates(orderedRecords);

        int shortWindow = rule.shortWindow();
        int longWindow = rule.longWindow();
        BigDecimal shortWindowFactor = BigDecimal.valueOf(shortWindow);
        BigDecimal longWindowFactor = BigDecimal.valueOf(longWindow);
        BigDecimal shortSum = BigDecimal.ZERO;
        BigDecimal longSum = BigDecimal.ZERO;
        Integer previousAverageComparison = null;
        var alerts = new java.util.ArrayList<Alert>();

        for (int i = 0; i < orderedRecords.size(); i++) {
            BigDecimal close = orderedRecords.get(i).close();
            shortSum = shortSum.add(close);
            longSum = longSum.add(close);

            if (i >= shortWindow) {
                shortSum = shortSum.subtract(orderedRecords.get(i - shortWindow).close());
            }
            if (i >= longWindow) {
                longSum = longSum.subtract(orderedRecords.get(i - longWindow).close());
            }

            if (i < longWindow - 1) {
                continue;
            }

            // Compare the exact rational averages without division or rounding.
            int currentAverageComparison = shortSum.multiply(longWindowFactor)
                    .compareTo(longSum.multiply(shortWindowFactor));
            if (previousAverageComparison != null) {
                PriceRecord current = orderedRecords.get(i);
                if (previousAverageComparison <= 0 && currentAverageComparison > 0
                        && (rule.direction() == null
                        || rule.direction() == RuleDirection.ABOVE)) {
                    alerts.add(createAlert(rule, current, "MA_BULLISH",
                            "short moving average crossed above long moving average"));
                } else if (previousAverageComparison >= 0 && currentAverageComparison < 0
                        && (rule.direction() == null
                        || rule.direction() == RuleDirection.BELOW)) {
                    alerts.add(createAlert(rule, current, "MA_BEARISH",
                            "short moving average crossed below long moving average"));
                }
            }
            previousAverageComparison = currentAverageComparison;
        }
        return List.copyOf(alerts);
    }

    private static Alert createAlert(AlertRule rule, PriceRecord record,
                                     String alertType, String direction) {
        return new Alert(record.date(), rule.id(), rule.instrument(), alertType,
                rule.instrument() + " " + direction + " for windows "
                        + rule.shortWindow() + "/" + rule.longWindow());
    }

    private static void rejectDuplicateDates(List<PriceRecord> records) {
        for (int i = 1; i < records.size(); i++) {
            if (records.get(i - 1).date().equals(records.get(i).date())) {
                throw new IllegalArgumentException("duplicate price observation for instrument "
                        + records.get(i).instrument() + " on " + records.get(i).date());
            }
        }
    }
}
