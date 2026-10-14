package com.wissen.pricealert.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.LocalDate;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("validation")
class AlertTest {

    @Test
    void createsAlertWithDescription() {
        var date = LocalDate.of(2026, 1, 2);
        var alert = new Alert(date, "R1", "ABC", "LEVEL", "ABC crossed 10.00");

        assertEquals(date, alert.date());
        assertEquals("R1", alert.ruleId());
        assertEquals("ABC", alert.instrument());
        assertEquals("LEVEL", alert.alertType());
        assertEquals("ABC crossed 10.00", alert.description());
        assertEquals(alert, new Alert(date, "R1", "ABC", "LEVEL", "ABC crossed 10.00"));
    }

    @Test
    void rejectsMissingAndBlankRequiredValues() {
        var date = LocalDate.of(2026, 1, 1);
        assertThrows(NullPointerException.class,
                () -> new Alert(null, "R1", "ABC", "LEVEL", "description"));
        assertThrows(NullPointerException.class,
                () -> new Alert(date, null, "ABC", "LEVEL", "description"));
        assertThrows(NullPointerException.class,
                () -> new Alert(date, "R1", null, "LEVEL", "description"));
        assertThrows(NullPointerException.class,
                () -> new Alert(date, "R1", "ABC", null, "description"));
        assertThrows(NullPointerException.class,
                () -> new Alert(date, "R1", "ABC", "LEVEL", null));
        assertThrows(IllegalArgumentException.class,
                () -> new Alert(date, " ", "ABC", "LEVEL", "description"));
        assertThrows(IllegalArgumentException.class,
                () -> new Alert(date, "R1", "ABC", "LEVEL", " "));
    }
}
