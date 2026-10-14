package com.wissen.pricealert.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

/**
 * One observed closing price. Close prices must be strictly positive.
 */
public record PriceRecord(LocalDate date, String instrument, BigDecimal close) {

    public PriceRecord {
        Objects.requireNonNull(date, "date must not be null");
        requireText(instrument, "instrument");
        Objects.requireNonNull(close, "close must not be null");
        if (close.signum() <= 0) {
            throw new IllegalArgumentException("close must be positive");
        }
    }

    private static void requireText(String value, String fieldName) {
        Objects.requireNonNull(value, fieldName + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
    }
}
