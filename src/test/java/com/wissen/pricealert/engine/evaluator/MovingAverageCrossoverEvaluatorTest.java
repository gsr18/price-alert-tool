package com.wissen.pricealert.engine.evaluator;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.wissen.pricealert.domain.AlertRule;
import com.wissen.pricealert.domain.PriceRecord;
import com.wissen.pricealert.domain.RuleDirection;
import com.wissen.pricealert.domain.RuleType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

@Tag("engine")
class MovingAverageCrossoverEvaluatorTest {

    private final MovingAverageCrossoverEvaluator evaluator =
            new MovingAverageCrossoverEvaluator();

    @ParameterizedTest
    @CsvSource({
            "10, 8, 9, MA_BULLISH",
            "8, 10, 9, MA_BEARISH"
    })
    void detectsBullishAndBearishCrossovers(
            String first, String second, String third, String expectedType) {
        var alerts = evaluator.evaluate(records("ABC", first, second, third),
                movingRule("ABC"));

        assertEquals(1, alerts.size());
        assertEquals(expectedType, alerts.get(0).alertType());
        assertEquals(LocalDate.of(2026, 1, 3), alerts.get(0).date());
    }

    @Test
    void equalMovingAveragesDoNotTrigger() {
        assertEquals(0, evaluator.evaluate(records("ABC", "10", "10", "10", "10"),
                movingRule("ABC")).size());
    }

    @Test
    void comparesHighMagnitudeAveragesWithoutRoundingAwayTheCrossover() {
        BigDecimal large = new BigDecimal("1E+100");
        var records = List.of(
                new PriceRecord(LocalDate.of(2026, 1, 1), "ABC", large),
                new PriceRecord(LocalDate.of(2026, 1, 2), "ABC", large),
                new PriceRecord(LocalDate.of(2026, 1, 3), "ABC", large),
                new PriceRecord(LocalDate.of(2026, 1, 4), "ABC", large.add(BigDecimal.ONE)));
        var rule = new AlertRule("MA-ABC", "ABC", RuleType.MA_CROSS, null, 2, 3);

        var alerts = evaluator.evaluate(records, rule);

        assertEquals(1, alerts.size());
        assertEquals("MA_BULLISH", alerts.get(0).alertType());
    }

    @Test
    void requiresCurrentAndPreviousCompleteLongWindowAverages() {
        assertEquals(0, evaluator.evaluate(records("ABC", "10", "8"),
                movingRule("ABC")).size());
    }

    @Test
    void explicitDirectionOnlyEmitsMatchingMovingAverageCrossings() {
        var aboveRule = movingRule("ABC", RuleDirection.ABOVE);
        var belowRule = movingRule("ABC", RuleDirection.BELOW);

        assertEquals("MA_BULLISH",
                evaluator.evaluate(records("ABC", "10", "8", "9"), aboveRule)
                        .get(0).alertType());
        assertEquals(0,
                evaluator.evaluate(records("ABC", "10", "8", "9"), belowRule).size());
        assertEquals("MA_BEARISH",
                evaluator.evaluate(records("ABC", "8", "10", "9"), belowRule)
                        .get(0).alertType());
        assertEquals(0,
                evaluator.evaluate(records("ABC", "8", "10", "9"), aboveRule).size());
    }

    @Test
    void explicitDirectionDoesNotAlertWithoutCrossover() {
        assertEquals(0, evaluator.evaluate(records("ABC", "10", "11", "12", "13"),
                movingRule("ABC", RuleDirection.ABOVE)).size());
        assertEquals(0, evaluator.evaluate(records("ABC", "10", "9", "8", "7"),
                movingRule("ABC", RuleDirection.BELOW)).size());
    }

    @Test
    void doesNotCombinePricesFromDifferentInstruments() {
        var mixed = List.of(
                price(1, "ABC", "10"),
                price(1, "XYZ", "100"),
                price(2, "ABC", "8"),
                price(2, "XYZ", "1"),
                price(3, "ABC", "9"),
                price(3, "XYZ", "1000"));

        var alerts = evaluator.evaluate(mixed, movingRule("ABC"));

        assertEquals(1, alerts.size());
        assertEquals("ABC", alerts.get(0).instrument());
        assertEquals("MA_BULLISH", alerts.get(0).alertType());
    }

    @Test
    void calendarGapsDoNotInterruptObservedRecordSequence() {
        var spacedRecords = List.of(
                price(1, "ABC", "10"),
                new PriceRecord(LocalDate.of(2026, 2, 15), "ABC", new BigDecimal("8")),
                new PriceRecord(LocalDate.of(2026, 12, 31), "ABC", new BigDecimal("9")));

        var alerts = evaluator.evaluate(spacedRecords, movingRule("ABC"));

        assertEquals(1, alerts.size());
        assertEquals(LocalDate.of(2026, 12, 31), alerts.get(0).date());
        assertEquals("MA_BULLISH", alerts.get(0).alertType());
    }

    private static AlertRule movingRule(String instrument) {
        return new AlertRule("MA-" + instrument, instrument, RuleType.MA_CROSS,
                null, 1, 2);
    }

    private static AlertRule movingRule(String instrument, RuleDirection direction) {
        return new AlertRule("MA-" + instrument, instrument, RuleType.MA_CROSS,
                null, 1, 2, direction);
    }

    private static List<PriceRecord> records(String instrument, String... prices) {
        var records = new ArrayList<PriceRecord>();
        for (int i = 0; i < prices.length; i++) {
            records.add(price(i + 1, instrument, prices[i]));
        }
        return records;
    }

    private static PriceRecord price(int day, String instrument, String close) {
        return new PriceRecord(LocalDate.of(2026, 1, day), instrument, new BigDecimal(close));
    }
}
