package com.wissen.pricealert.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("validation")
class PriceRecordTest {

    @Test
    void createsRecordAndExposesImmutableValues() {
        var date = LocalDate.of(2026, 1, 1);
        var close = new BigDecimal("123.45");
        var record = new PriceRecord(date, "ABC", close);

        assertEquals(date, record.date());
        assertEquals("ABC", record.instrument());
        assertEquals(close, record.close());
        assertEquals(record, new PriceRecord(date, "ABC", close));
    }

    @Test
    void rejectsMissingRequiredValues() {
        assertThrows(NullPointerException.class,
                () -> new PriceRecord(null, "ABC", BigDecimal.ONE));
        assertThrows(NullPointerException.class,
                () -> new PriceRecord(LocalDate.of(2026, 1, 1), null, BigDecimal.ONE));
        assertThrows(NullPointerException.class,
                () -> new PriceRecord(LocalDate.of(2026, 1, 1), "ABC", null));
        assertThrows(IllegalArgumentException.class,
                () -> new PriceRecord(LocalDate.of(2026, 1, 1), " ", BigDecimal.ONE));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-0.01", "-100"})
    void rejectsNonPositiveClosePrices(String close) {
        assertThrows(IllegalArgumentException.class,
                () -> new PriceRecord(LocalDate.of(2026, 1, 1), "ABC",
                        new BigDecimal(close)));
    }
}
