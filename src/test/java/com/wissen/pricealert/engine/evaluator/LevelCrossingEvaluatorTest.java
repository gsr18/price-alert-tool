package com.wissen.pricealert.engine.evaluator;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.wissen.pricealert.domain.AlertRule;
import com.wissen.pricealert.domain.PriceRecord;
import com.wissen.pricealert.domain.RuleDirection;
import com.wissen.pricealert.domain.RuleType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

@Tag("engine")
class LevelCrossingEvaluatorTest {

    private final LevelCrossingEvaluator evaluator = new LevelCrossingEvaluator();

    @ParameterizedTest
    @CsvSource({
            "10, 11, LEVEL_UP",
            "9, 11, LEVEL_UP",
            "10, 9, LEVEL_DOWN",
            "11, 9, LEVEL_DOWN"
    })
    void detectsCrossingsIncludingPreviousPriceEquality(
            String previous, String current, String expectedType) {
        var alerts = evaluator.evaluate(records(previous, current), levelRule("10"));

        assertEquals(1, alerts.size());
        assertEquals(expectedType, alerts.get(0).alertType());
        assertEquals(LocalDate.of(2026, 1, 2), alerts.get(0).date());
    }

    @Test
    void equalityAtCurrentThresholdDoesNotTriggerButAllowsNextCrossing() {
        var alerts = evaluator.evaluate(records("9", "10", "11"),
                levelRule("10"));

        assertEquals(1, alerts.size());
        assertEquals(LocalDate.of(2026, 1, 3), alerts.get(0).date());
        assertEquals("LEVEL_UP", alerts.get(0).alertType());
    }

    @Test
    void acceptsNegativeThresholdsWhenPositivePricesCannotCrossThem() {
        var rule = levelRule("-1.00000000000000000001");
        var alerts = evaluator.evaluate(records("1.00000000000000000002",
                "1.00000000000000000000"), rule);

        assertEquals(0, alerts.size());
    }

    @Test
    void doesNotTriggerWhenPricesStayOnSameSideOrOnlyTouchThreshold() {
        assertEquals(0, evaluator.evaluate(records("8", "9", "10", "10"),
                levelRule("10")).size());
        assertEquals(0, evaluator.evaluate(records("12", "11", "10", "10"),
                levelRule("10")).size());
    }

    @Test
    void explicitDirectionsOnlyEmitMatchingCrossings() {
        var belowRule = levelRule("10", RuleDirection.BELOW);
        var aboveRule = levelRule("10", RuleDirection.ABOVE);

        assertEquals("LEVEL_DOWN",
                evaluator.evaluate(records("11", "9"), belowRule).get(0).alertType());
        assertEquals("LEVEL_DOWN",
                evaluator.evaluate(records("10", "9"), belowRule).get(0).alertType());
        assertEquals(0, evaluator.evaluate(records("9", "11"), belowRule).size());
        assertEquals("LEVEL_UP",
                evaluator.evaluate(records("9", "11"), aboveRule).get(0).alertType());
        assertEquals("LEVEL_UP",
                evaluator.evaluate(records("10", "11"), aboveRule).get(0).alertType());
        assertEquals(0, evaluator.evaluate(records("11", "9"), aboveRule).size());
    }

    @Test
    void explicitDirectionDoesNotAlertForTouchOrContinuationOnSameSide() {
        assertEquals(0, evaluator.evaluate(records("9", "10", "10"),
                levelRule("10", RuleDirection.ABOVE)).size());
        assertEquals(0, evaluator.evaluate(records("11", "12", "13"),
                levelRule("10", RuleDirection.ABOVE)).size());
        assertEquals(0, evaluator.evaluate(records("9", "8", "7"),
                levelRule("10", RuleDirection.BELOW)).size());
    }

    @Test
    void firstObservationCannotTrigger() {
        assertEquals(0, evaluator.evaluate(records("11"), levelRule("10")).size());
    }

    private static AlertRule levelRule(String threshold) {
        return new AlertRule("R1", "ABC", RuleType.LEVEL,
                new BigDecimal(threshold), null, null);
    }

    private static AlertRule levelRule(String threshold, RuleDirection direction) {
        return new AlertRule("R1", "ABC", RuleType.LEVEL,
                new BigDecimal(threshold), null, null, direction);
    }

    private static List<PriceRecord> records(String... prices) {
        var records = new java.util.ArrayList<PriceRecord>();
        for (int i = 0; i < prices.length; i++) {
            records.add(new PriceRecord(LocalDate.of(2026, 1, i + 1), "ABC",
                    new BigDecimal(prices[i])));
        }
        return records;
    }
}
