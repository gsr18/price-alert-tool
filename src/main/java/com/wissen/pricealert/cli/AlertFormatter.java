package com.wissen.pricealert.cli;

import com.wissen.pricealert.domain.Alert;
import java.util.List;

public final class AlertFormatter {

    public String format(List<Alert> alerts) {
        if (alerts.isEmpty()) {
            return "No alerts generated.";
        }
        return alerts.stream()
                .map(alert -> alert.date() + " | rule=" + alert.ruleId()
                        + " | instrument=" + alert.instrument()
                        + " | type=" + alert.alertType()
                        + " | " + alert.description())
                .collect(java.util.stream.Collectors.joining(System.lineSeparator()));
    }
}
