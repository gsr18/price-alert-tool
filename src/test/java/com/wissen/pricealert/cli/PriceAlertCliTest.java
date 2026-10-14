package com.wissen.pricealert.cli;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Arrays;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.io.TempDir;

@Tag("cli")
@Tag("validation")
class PriceAlertCliTest {

    @TempDir
    Path tempDir;

    @Test
    void evaluatesAndPrintsAlertsInDeterministicOrder() throws Exception {
        Path prices = write("prices.csv", "date,instrument,close\n"
                + "2026-01-03,ABC,12\n"
                + "2026-01-01,ABC,9\n"
                + "2026-01-02,ABC,11\n");
        Path rules = write("rules.json", """
                [
                  {"id":"B","instrument":"ABC","type":"level","threshold":10},
                  {"id":"A","instrument":"ABC","type":"level","threshold":10}
                ]
                """);
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int result = new PriceAlertCli().run(args(prices, rules),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(0, result);
        assertEquals("2026-01-02 | rule=A | instrument=ABC | type=LEVEL_UP"
                        + " | ABC crossed above 10 (from 9 to 11)"
                        + System.lineSeparator()
                        + "2026-01-02 | rule=B | instrument=ABC | type=LEVEL_UP"
                        + " | ABC crossed above 10 (from 9 to 11)"
                        + System.lineSeparator(),
                output.toString());
        assertEquals("", errors.toString());
    }

    @Test
    void loadsExactAssessmentSchemaAndEmitsDirectedAlerts() throws Exception {
        StringBuilder pricesData = new StringBuilder("date,instrument,close\n")
                .append("2026-01-02,INFY,1490\n")
                .append("2026-01-01,INFY,1501\n");
        for (int day = 1; day <= 20; day++) {
            pricesData.append(LocalDate.of(2026, 1, day))
                    .append(",TCS,10\n");
        }
        pricesData.append("2026-01-21,TCS,20\n");
        Path prices = write("official-prices.csv", pricesData.toString());
        Path rules = write("official-rules.json", """
                [
                  {"id":"r1","instrument":"INFY","type":"level",
                   "direction":"below","level":1500},
                  {"id":"r2","instrument":"TCS","type":"ma_cross",
                   "short":5,"long":20,"direction":"above"}
                ]
                """);
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int result = new PriceAlertCli().run(args(prices, rules),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(0, result);
        assertEquals("2026-01-02 | rule=r1 | instrument=INFY | type=LEVEL_DOWN"
                        + " | INFY crossed below 1500 (from 1501 to 1490)"
                        + System.lineSeparator()
                        + "2026-01-21 | rule=r2 | instrument=TCS | type=MA_BULLISH"
                        + " | TCS short moving average crossed above long moving average for windows 5/20"
                        + System.lineSeparator(),
                output.toString());
        assertEquals("", errors.toString());
    }

    @Test
    void succeedsAndPrintsNoAlertsForValidEmptyInputs() throws Exception {
        Path prices = write("prices.csv", "date,instrument,close\n");
        Path rules = write("rules.json", "[]");
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int result = new PriceAlertCli().run(args(prices, rules),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(0, result);
        assertEquals("No alerts generated." + System.lineSeparator(), output.toString());
        assertEquals("", errors.toString());
    }

    @Test
    void succeedsWithEmptyPriceHistoryAndValidRules() throws Exception {
        Path prices = write("empty-prices.csv", "date,instrument,close\n");
        Path rules = write("level-rule.json",
                "[{\"id\":\"R1\",\"instrument\":\"ABC\",\"type\":\"level\",\"threshold\":10}]");
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int result = new PriceAlertCli().run(args(prices, rules),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(0, result);
        assertEquals("No alerts generated." + System.lineSeparator(), output.toString());
        assertEquals("", errors.toString());
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 3})
    void rejectsArgumentCountsOtherThanTwo(int argumentCount) {
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();
        String[] args = new String[argumentCount];
        Arrays.fill(args, "unused");

        int badArguments = new PriceAlertCli().run(args,
                new PrintStream(output), new PrintStream(errors));

        assertEquals(2, badArguments);
        assertEquals("", output.toString());
        assertEquals(true, errors.toString().contains("Usage:"));
        assertEquals(true, errors.toString().contains("<prices.csv> <rules.json>"));
    }

    @Test
    void reportsMissingFilesToStandardError() {
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int missingFile = new PriceAlertCli().run(new String[]{
                        tempDir.resolve("missing.csv").toString(),
                        tempDir.resolve("missing.json").toString()},
                new PrintStream(output), new PrintStream(errors));
        assertEquals(1, missingFile);
        assertEquals("", output.toString());
        assertEquals(true, errors.toString().contains("not readable"));
    }

    @Test
    void reportsInvalidInputWithNonZeroExitAndNoStackTrace() throws Exception {
        Path prices = write("bad-prices.csv", "date,instrument,close\nbad,ABC,10\n");
        Path rules = write("rules.json", "[]");
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int result = new PriceAlertCli().run(args(prices, rules),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(1, result);
        assertEquals("", output.toString());
        assertEquals(true, errors.toString().contains("record 1"));
        assertEquals(false, errors.toString().contains("Exception"));
    }

    @Test
    void reportsDuplicateObservationsAndRuleIdsAsInputErrors() throws Exception {
        Path duplicatePrices = write("duplicate-prices.csv", "date,instrument,close\n"
                + "2026-01-01,ABC,10\n2026-01-01,ABC,11\n");
        Path duplicateRules = write("duplicate-rules.json", """
                [
                  {"id":"R1","instrument":"ABC","type":"level","threshold":10},
                  {"id":"R1","instrument":"XYZ","type":"level","threshold":10}
                ]
                """);
        Path validPrices = write("valid-prices.csv", "date,instrument,close\n");
        var output = new ByteArrayOutputStream();
        var errors = new ByteArrayOutputStream();

        int duplicateObservationResult = new PriceAlertCli().run(args(duplicatePrices,
                        write("empty-rules.json", "[]")),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(1, duplicateObservationResult);
        assertEquals("", output.toString());
        assertEquals(true, errors.toString().contains("duplicate price observation"));

        output.reset();
        errors.reset();
        int duplicateRuleResult = new PriceAlertCli().run(args(validPrices, duplicateRules),
                new PrintStream(output), new PrintStream(errors));

        assertEquals(1, duplicateRuleResult);
        assertEquals("", output.toString());
        assertEquals(true, errors.toString().contains("duplicate alert rule id"));
    }

    private Path write(String name, String content) throws Exception {
        return Files.writeString(tempDir.resolve(name), content);
    }

    private static String[] args(Path prices, Path rules) {
        return new String[]{prices.toString(), rules.toString()};
    }
}
