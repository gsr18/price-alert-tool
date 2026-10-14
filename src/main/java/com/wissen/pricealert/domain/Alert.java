package com.wissen.pricealert.domain;

import java.time.LocalDate;
import java.util.Objects;

public record Alert(
        LocalDate date,
        String ruleId,
        String instrument,
        String alertType,
        String description) {

    public Alert {
        Objects.requireNonNull(date, "date must not be null");
        requireText(ruleId, "ruleId");
        requireText(instrument, "instrument");
        requireText(alertType, "alertType");
        requireText(description, "description");
    }

    private static void requireText(String value, String fieldName) {
        Objects.requireNonNull(value, fieldName + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
    }
}
