package com.wissen.pricealert.engine;

import com.wissen.pricealert.domain.Alert;
import com.wissen.pricealert.domain.AlertRule;
import com.wissen.pricealert.domain.PriceRecord;
import com.wissen.pricealert.domain.RuleType;
import com.wissen.pricealert.engine.evaluator.LevelCrossingEvaluator;
import com.wissen.pricealert.engine.evaluator.MovingAverageCrossoverEvaluator;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

public final class AlertEngine {

    private final LevelCrossingEvaluator levelEvaluator = new LevelCrossingEvaluator();
    private final MovingAverageCrossoverEvaluator movingAverageEvaluator =
            new MovingAverageCrossoverEvaluator();

    public List<Alert> evaluate(List<PriceRecord> records, List<AlertRule> rules) {
        Objects.requireNonNull(records, "records must not be null");
        Objects.requireNonNull(rules, "rules must not be null");
        validateUniqueObservations(records);
        validateUniqueRuleIds(rules);

        var alerts = new ArrayList<Alert>();
        for (AlertRule rule : rules) {
            Objects.requireNonNull(rule, "rules must not contain null");
            if (rule.type() == RuleType.LEVEL) {
                alerts.addAll(levelEvaluator.evaluate(records, rule));
            } else {
                alerts.addAll(movingAverageEvaluator.evaluate(records, rule));
            }
        }

        alerts.sort(Comparator.comparing(Alert::date).thenComparing(Alert::ruleId));
        return List.copyOf(alerts);
    }

    private static void validateUniqueObservations(List<PriceRecord> records) {
        Set<ObservationKey> observations = new HashSet<>();
        for (PriceRecord record : records) {
            Objects.requireNonNull(record, "records must not contain null");
            ObservationKey key = new ObservationKey(record.instrument(), record.date());
            if (!observations.add(key)) {
                throw new IllegalArgumentException("duplicate price observation for instrument "
                        + record.instrument() + " on " + record.date());
            }
        }
    }

    private static void validateUniqueRuleIds(List<AlertRule> rules) {
        Set<String> ruleIds = new HashSet<>();
        for (AlertRule rule : rules) {
            Objects.requireNonNull(rule, "rules must not contain null");
            if (!ruleIds.add(rule.id())) {
                throw new IllegalArgumentException("duplicate alert rule id: " + rule.id());
            }
        }
    }

    private record ObservationKey(String instrument, LocalDate date) {
    }
}
