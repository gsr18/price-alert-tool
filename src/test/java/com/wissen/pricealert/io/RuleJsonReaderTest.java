package com.wissen.pricealert.io;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("json")
@Tag("validation")
class RuleJsonReaderTest {

    @TempDir
    Path tempDir;

    private final RuleJsonReader reader = new RuleJsonReader();

    @Test
    void parsesBothSupportedRuleTypes() throws IOException {
        Path file = write("""
                [
                  {"id":"R1","instrument":"ABC","type":"level","threshold":10.25},
                  {"id":"R2","instrument":"XYZ","type":"ma_cross","shortWindow":3,"longWindow":5}
                ]
                """);

        var rules = reader.read(file);

        assertEquals(2, rules.size());
        assertEquals("10.25", rules.get(0).threshold().toPlainString());
        assertNull(rules.get(0).shortWindow());
        assertEquals(3, rules.get(1).shortWindow());
        assertEquals(5, rules.get(1).longWindow());
        assertNull(rules.get(1).threshold());
    }

    @Test
    void parsesOfficialSchemaAndCaseInsensitiveEnums() throws IOException {
        var rules = reader.read(write("""
                [
                  {"id":"r1","instrument":"INFY","type":"level",
                   "direction":"below","level":1500},
                  {"id":"r2","instrument":"TCS","type":"MA_CROSS",
                   "short":5,"long":20,"direction":"ABOVE"}
                ]
                """));

        assertEquals("1500", rules.get(0).threshold().toPlainString());
        assertEquals(com.wissen.pricealert.domain.RuleDirection.BELOW,
                rules.get(0).direction());
        assertEquals(5, rules.get(1).shortWindow());
        assertEquals(20, rules.get(1).longWindow());
        assertEquals(com.wissen.pricealert.domain.RuleDirection.ABOVE,
                rules.get(1).direction());
    }

    @Test
    void acceptsEqualAliasValuesButRejectsConflictsAndUnsupportedFields() throws IOException {
        assertEquals(new java.math.BigDecimal("10"),
                reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"LEVEL",
                          "level":10,"threshold":10}]
                        """)).get(0).threshold());
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"LEVEL",
                          "level":10,"threshold":11}]
                        """))).getMessage().contains("conflicting fields"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"LEVEL",
                          "level":10,"short":2}]
                        """))).getMessage().contains("unsupported field"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"LEVEL",
                          "level":10,"extra":true}]
                        """))).getMessage().contains("unsupported field"));
    }

    @Test
    void rejectsMissingAndInvalidDirectionsAndLevels() throws IOException {
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"level","direction":"sideways",
                          "level":10}]
                        """))).getMessage().contains("invalid direction"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"level","direction":4,
                          "level":10}]
                        """))).getMessage().contains("direction"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"level","direction":"above"}]
                        """))).getMessage().contains("level"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"level","level":10,
                          "threshold":"10"}]
                        """))).getMessage().contains("threshold"));
    }

    @Test
    void rejectsInvalidMovingAverageAliasesDirectionsAndDuplicateIds() throws IOException {
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"ma_cross",
                          "short":2,"long":3,"shortWindow":1}]
                        """))).getMessage().contains("conflicting fields"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"ma_cross",
                          "short":2,"long":3,"direction":"sideways"}]
                        """))).getMessage().contains("invalid direction"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"ma_cross",
                          "short":2,"long":2}]
                        """))).getMessage().contains("shortWindow"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"level","level":10},
                         {"id":"R1","instrument":"XYZ","type":"level","level":11}]
                        """))).getMessage().contains("duplicate alert rule id"));
        assertTrue(assertThrows(IOException.class, () -> reader.read(write("""
                        [{"id":"R1","id":"R2","instrument":"ABC","type":"level","level":10}]
                        """))).getMessage().contains("Duplicate field"));
    }

    @Test
    void preservesHighPrecisionDecimalThresholds() throws IOException {
        String threshold = "123456789012345678901234567890.12345678901234567890";
        var rules = reader.read(write("[{\"id\":\"R1\",\"instrument\":\"ABC\","
                + "\"type\":\"level\",\"threshold\":" + threshold + "}]"));

        assertEquals(0, new java.math.BigDecimal(threshold)
                .compareTo(rules.get(0).threshold()));
    }

    @Test
    void rejectsMalformedJsonAndNonArrayRoots() throws IOException {
        var malformed = assertThrows(IOException.class,
                () -> reader.read(write("[{")));
        assertEquals(true, malformed.getMessage().contains("Invalid rules JSON"));

        var wrongRoot = assertThrows(IOException.class,
                () -> reader.read(write("{}")));
        assertEquals(true, wrongRoot.getMessage().contains("JSON array"));
    }

    @Test
    void rejectsTrailingJsonTokens() throws IOException {
        var error = assertThrows(IOException.class,
                () -> reader.read(write("[] []")));

        assertEquals(true, error.getMessage().contains("Invalid rules JSON"));
    }

    @Test
    void rejectsUnsupportedTypesMissingFieldsAndInvalidWindows() throws IOException {
        assertEquals(true, assertThrows(IOException.class,
                () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"other"}]
                        """))).getMessage().contains("unsupported rule type"));
        assertEquals(true, assertThrows(IOException.class,
                () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"level"}]
                        """))).getMessage().contains("threshold"));
        assertEquals(true, assertThrows(IOException.class,
                () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"ma_cross",
                          "shortWindow":3}]
                        """))).getMessage().contains("longWindow"));
        assertEquals(true, assertThrows(IOException.class,
                () -> reader.read(write("""
                        [{"id":"R1","instrument":"ABC","type":"ma_cross",
                          "shortWindow":5,"longWindow":3}]
                        """))).getMessage().contains("shortWindow"));
    }

    @Test
    void emptyRuleArrayIsValid() throws IOException {
        assertEquals(0, reader.read(write("[]")).size());
    }

    private Path write(String content) throws IOException {
        Path file = tempDir.resolve("rules-" + UUID.randomUUID() + ".json");
        return Files.writeString(file, content);
    }
}
