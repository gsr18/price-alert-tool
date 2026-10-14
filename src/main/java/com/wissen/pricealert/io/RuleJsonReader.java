package com.wissen.pricealert.io;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wissen.pricealert.domain.AlertRule;
import com.wissen.pricealert.domain.RuleDirection;
import com.wissen.pricealert.domain.RuleType;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class RuleJsonReader {

    private final ObjectMapper objectMapper = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    public List<AlertRule> read(Path path) throws IOException {
        JsonNode root;
        try {
            root = objectMapper.readTree(path.toFile());
        } catch (JsonProcessingException e) {
            throw new IOException("Invalid rules JSON in '" + path + "': "
                    + e.getOriginalMessage(), e);
        } catch (IOException e) {
            throw new IOException("Could not read rules JSON '" + path + "': "
                    + e.getMessage(), e);
        }

        if (root == null || !root.isArray()) {
            throw new IOException("Rules JSON '" + path + "' must contain a JSON array");
        }

        var rules = new ArrayList<AlertRule>();
        var ruleIds = new HashSet<String>();
        for (int i = 0; i < root.size(); i++) {
            String context = "Rule at array index " + i + ": ";
            JsonNode node = root.get(i);
            if (!node.isObject()) {
                throw new IOException(context + "expected a JSON object");
            }

            try {
                String id = requiredText(node, "id", context);
                String instrument = requiredText(node, "instrument", context);
                RuleType type = parseType(requiredText(node, "type", context), context);
                BigDecimal threshold = null;
                Integer shortWindow = null;
                Integer longWindow = null;
                RuleDirection direction = optionalDirection(node, context);
                if (type == RuleType.LEVEL) {
                    validateFields(node, context, Set.of(
                            "id", "instrument", "type", "direction", "level", "threshold"));
                    threshold = aliasedDecimal(node, "level", "threshold", context);
                } else {
                    validateFields(node, context, Set.of(
                            "id", "instrument", "type", "direction",
                            "short", "long", "shortWindow", "longWindow"));
                    shortWindow = aliasedInteger(node, "short", "shortWindow", context);
                    longWindow = aliasedInteger(node, "long", "longWindow", context);
                }
                if (!ruleIds.add(id)) {
                    throw new IOException(context + "duplicate alert rule id: " + id);
                }
                rules.add(new AlertRule(id, instrument, type,
                        threshold, shortWindow, longWindow, direction));
            } catch (IllegalArgumentException e) {
                throw new IOException(context + e.getMessage(), e);
            }
        }
        return List.copyOf(rules);
    }

    private static String requiredText(JsonNode object, String field, String context)
            throws IOException {
        JsonNode value = object.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new IOException(context + "field '" + field
                    + "' is required and must be a non-blank string");
        }
        return value.textValue();
    }

    private static RuleType parseType(String value, String context) throws IOException {
        try {
            return RuleType.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IOException(context + "unsupported rule type '" + value
                    + "'; expected LEVEL or MA_CROSS");
        }
    }

    private static RuleDirection optionalDirection(JsonNode object, String context)
            throws IOException {
        JsonNode value = object.get("direction");
        if (value == null) {
            return null;
        }
        if (!value.isTextual()) {
            throw new IOException(context
                    + "field 'direction' must be 'above' or 'below'");
        }
        try {
            return RuleDirection.valueOf(value.textValue().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IOException(context + "invalid direction '" + value.textValue()
                    + "'; expected above or below");
        }
    }

    private static BigDecimal aliasedDecimal(
            JsonNode object, String officialField, String legacyField, String context)
            throws IOException {
        JsonNode officialValue = object.get(officialField);
        JsonNode legacyValue = object.get(legacyField);
        if (officialValue == null && legacyValue == null) {
            throw new IOException(context + "field '" + officialField + "' (or legacy field '"
                    + legacyField + "') is required and must be numeric");
        }
        BigDecimal officialNumber = decimalValue(officialValue, officialField, context);
        BigDecimal legacyNumber = decimalValue(legacyValue, legacyField, context);
        if (officialNumber != null && legacyNumber != null
                && officialNumber.compareTo(legacyNumber) != 0) {
            throw new IOException(context + "conflicting fields '" + officialField
                    + "' and '" + legacyField + "' must have the same value");
        }
        return officialNumber != null ? officialNumber : legacyNumber;
    }

    private static BigDecimal decimalValue(JsonNode value, String field, String context)
            throws IOException {
        if (value == null) {
            return null;
        }
        if (!value.isNumber()) {
            throw new IOException(context + "field '" + field + "' must be numeric");
        }
        return value.decimalValue();
    }

    private static Integer aliasedInteger(
            JsonNode object, String officialField, String legacyField, String context)
            throws IOException {
        JsonNode officialValue = object.get(officialField);
        JsonNode legacyValue = object.get(legacyField);
        if (officialValue == null && legacyValue == null) {
            throw new IOException(context + "field '" + officialField + "' (or legacy field '"
                    + legacyField + "') is required and must be an integer");
        }
        Integer officialNumber = integerValue(officialValue, officialField, context);
        Integer legacyNumber = integerValue(legacyValue, legacyField, context);
        if (officialNumber != null && legacyNumber != null
                && !officialNumber.equals(legacyNumber)) {
            throw new IOException(context + "conflicting fields '" + officialField
                    + "' and '" + legacyField + "' must have the same value");
        }
        return officialNumber != null ? officialNumber : legacyNumber;
    }

    private static Integer integerValue(JsonNode value, String field, String context)
            throws IOException {
        if (value == null) {
            return null;
        }
        if (!value.isIntegralNumber() || !value.canConvertToInt()) {
            throw new IOException(context + "field '" + field
                    + "' must be an integer within the supported range");
        }
        return value.intValue();
    }

    private static void validateFields(JsonNode object, String context, Set<String> allowed)
            throws IOException {
        var fieldNames = object.fieldNames();
        while (fieldNames.hasNext()) {
            String field = fieldNames.next();
            if (!allowed.contains(field)) {
                throw new IOException(context + "unsupported field '" + field
                        + "' for this rule type");
            }
        }
    }
}
