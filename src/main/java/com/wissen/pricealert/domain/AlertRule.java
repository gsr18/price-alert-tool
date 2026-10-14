package com.wissen.pricealert.domain;

import java.math.BigDecimal;
import java.util.Objects;

public record AlertRule(
        String id,
        String instrument,
        RuleType type,
        BigDecimal threshold,
        Integer shortWindow,
        Integer longWindow,
        RuleDirection direction) {

    public AlertRule(String id, String instrument, RuleType type,
                     BigDecimal threshold, Integer shortWindow, Integer longWindow) {
        this(id, instrument, type, threshold, shortWindow, longWindow, null);
    }

    public AlertRule {
        requireText(id, "id");
        requireText(instrument, "instrument");
        Objects.requireNonNull(type, "type must not be null");

        if (type == RuleType.LEVEL) {
            Objects.requireNonNull(threshold, "threshold is required for LEVEL rules");
            if (shortWindow != null || longWindow != null) {
                throw new IllegalArgumentException("LEVEL rules must not specify moving-average windows");
            }
        } else {
            if (threshold != null) {
                throw new IllegalArgumentException("MA_CROSS rules must not specify a threshold");
            }
            requirePositive(shortWindow, "shortWindow");
            requirePositive(longWindow, "longWindow");
            if (shortWindow >= longWindow) {
                throw new IllegalArgumentException("shortWindow must be less than longWindow");
            }
        }
    }

    private static void requirePositive(Integer value, String fieldName) {
        Objects.requireNonNull(value, fieldName + " is required for MA_CROSS rules");
        if (value <= 0) {
            throw new IllegalArgumentException(fieldName + " must be positive");
        }
    }

    private static void requireText(String value, String fieldName) {
        Objects.requireNonNull(value, fieldName + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
    }
}
