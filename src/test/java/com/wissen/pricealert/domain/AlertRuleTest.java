package com.wissen.pricealert.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("validation")
class AlertRuleTest {

    @Test
    void createsLevelRuleWithoutRequiringMovingAverageWindows() {
        var rule = new AlertRule("R1", "ABC", RuleType.LEVEL,
                new BigDecimal("10.00"), null, null);

        assertEquals("R1", rule.id());
        assertEquals("ABC", rule.instrument());
        assertEquals(RuleType.LEVEL, rule.type());
        assertEquals(new BigDecimal("10.00"), rule.threshold());
        assertNull(rule.shortWindow());
        assertNull(rule.longWindow());
    }

    @Test
    void levelThresholdMayBeZeroOrNegative() {
        assertEquals(BigDecimal.ZERO,
                new AlertRule("R0", "ABC", RuleType.LEVEL, BigDecimal.ZERO, null, null)
                        .threshold());
        assertEquals(new BigDecimal("-1.25"),
                new AlertRule("RN", "ABC", RuleType.LEVEL,
                        new BigDecimal("-1.25"), null, null).threshold());
    }

    @Test
    void createsMovingAverageRuleWithoutRequiringThreshold() {
        var rule = new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, 3, 5);

        assertEquals(RuleType.MA_CROSS, rule.type());
        assertNull(rule.threshold());
        assertEquals(3, rule.shortWindow());
        assertEquals(5, rule.longWindow());
    }

    @Test
    void rejectsMissingCommonFields() {
        assertThrows(NullPointerException.class,
                () -> new AlertRule(null, "ABC", RuleType.LEVEL, BigDecimal.ONE, null, null));
        assertThrows(NullPointerException.class,
                () -> new AlertRule("R1", null, RuleType.LEVEL, BigDecimal.ONE, null, null));
        assertThrows(NullPointerException.class,
                () -> new AlertRule("R1", "ABC", null, null, null, null));
        assertThrows(IllegalArgumentException.class,
                () -> new AlertRule(" ", "ABC", RuleType.LEVEL, BigDecimal.ONE, null, null));
        assertThrows(IllegalArgumentException.class,
                () -> new AlertRule("R1", " ", RuleType.LEVEL, BigDecimal.ONE, null, null));
    }

    @Test
    void validatesParametersSpecificToEachRuleType() {
        assertThrows(NullPointerException.class,
                () -> new AlertRule("R1", "ABC", RuleType.LEVEL, null, null, null));
        assertThrows(NullPointerException.class,
                () -> new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, null, 5));
        assertThrows(NullPointerException.class,
                () -> new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, 3, null));
        assertThrows(IllegalArgumentException.class,
                () -> new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, 0, 5));
        assertThrows(IllegalArgumentException.class,
                () -> new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, 3, -1));
        assertThrows(IllegalArgumentException.class,
                () -> new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, 5, 5));
        assertThrows(IllegalArgumentException.class,
                () -> new AlertRule("R2", "ABC", RuleType.MA_CROSS, null, 6, 5));
    }
}
