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

public final class LevelCrossingEvaluator {

    public List<Alert> evaluate(List<PriceRecord> records, AlertRule rule) {
        Objects.requireNonNull(records, "records must not be null");
        Objects.requireNonNull(rule, "rule must not be null");
        if (rule.type() != RuleType.LEVEL) {
            throw new IllegalArgumentException("rule must have type LEVEL");
        }

        List<PriceRecord> orderedRecords = records.stream()
                .map(record -> Objects.requireNonNull(record, "records must not contain null"))
                .filter(record -> record.instrument().equals(rule.instrument()))
                .sorted(Comparator.comparing(PriceRecord::date))
                .toList();
        rejectDuplicateDates(orderedRecords);

        var alerts = new java.util.ArrayList<Alert>();
        BigDecimal threshold = rule.threshold();
        for (int i = 1; i < orderedRecords.size(); i++) {
            PriceRecord previous = orderedRecords.get(i - 1);
            PriceRecord current = orderedRecords.get(i);
            int previousComparison = previous.close().compareTo(threshold);
            int currentComparison = current.close().compareTo(threshold);

            if (previousComparison <= 0 && currentComparison > 0
                    && (rule.direction() == null || rule.direction() == RuleDirection.ABOVE)) {
                alerts.add(new Alert(current.date(), rule.id(), rule.instrument(), "LEVEL_UP",
                        rule.instrument() + " crossed above " + threshold.toPlainString()
                                + " (from " + previous.close().toPlainString()
                                + " to " + current.close().toPlainString() + ")"));
            } else if (previousComparison >= 0 && currentComparison < 0
                    && (rule.direction() == null || rule.direction() == RuleDirection.BELOW)) {
                alerts.add(new Alert(current.date(), rule.id(), rule.instrument(), "LEVEL_DOWN",
                        rule.instrument() + " crossed below " + threshold.toPlainString()
                                + " (from " + previous.close().toPlainString()
                                + " to " + current.close().toPlainString() + ")"));
            }
        }
        return List.copyOf(alerts);
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
