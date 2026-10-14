package com.wissen.pricealert.engine;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.wissen.pricealert.domain.AlertRule;
import com.wissen.pricealert.domain.PriceRecord;
import com.wissen.pricealert.domain.RuleType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("engine")
class AlertEngineTest {

    private final AlertEngine engine = new AlertEngine();

    @Test
    void sortsUnorderedRecordsAndAlertsDeterministicallyByDateThenRuleId() {
        var rules = List.of(
                levelRule("B", "ABC", "10"),
                levelRule("A", "ABC", "10"),
                levelRule("C", "ABC", "20"));
        var records = List.of(
                price(3, "ABC", "21"),
                price(1, "ABC", "9"),
                price(2, "ABC", "11"),
                price(4, "ABC", "19"));

        var alerts = engine.evaluate(records, rules);

        assertEquals(List.of("A", "B", "C", "C"),
                alerts.stream().map(a -> a.ruleId()).toList());
        assertEquals(List.of(
                LocalDate.of(2026, 1, 2),
                LocalDate.of(2026, 1, 2),
                LocalDate.of(2026, 1, 3),
                LocalDate.of(2026, 1, 4)),
                alerts.stream().map(a -> a.date()).toList());
    }

    @Test
    void rejectsDuplicateInstrumentDateObservations() {
        var records = List.of(price(1, "ABC", "10"), price(1, "ABC", "11"));

        var error = assertThrows(IllegalArgumentException.class,
                () -> engine.evaluate(records, List.of()));

        assertEquals("duplicate price observation for instrument ABC on 2026-01-01",
                error.getMessage());
    }

    @Test
    void allowsSameDateForDifferentInstruments() {
        var alerts = engine.evaluate(List.of(
                        price(1, "ABC", "9"), price(1, "XYZ", "9"),
                        price(2, "ABC", "11"), price(2, "XYZ", "12")),
                List.of(levelRule("A", "ABC", "10"), levelRule("X", "XYZ", "10")));

        assertEquals(List.of("A", "X"), alerts.stream().map(a -> a.ruleId()).toList());
    }

    @Test
    void rejectsDuplicateRuleIds() {
        var rules = List.of(levelRule("R1", "ABC", "10"),
                levelRule("R1", "XYZ", "10"));

        var error = assertThrows(IllegalArgumentException.class,
                () -> engine.evaluate(List.of(), rules));

        assertEquals("duplicate alert rule id: R1", error.getMessage());
    }

    private static AlertRule levelRule(String id, String instrument, String threshold) {
        return new AlertRule(id, instrument, RuleType.LEVEL,
                new BigDecimal(threshold), null, null);
    }

    private static PriceRecord price(int day, String instrument, String close) {
        return new PriceRecord(LocalDate.of(2026, 1, day), instrument, new BigDecimal(close));
    }
}
