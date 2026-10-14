package com.wissen.pricealert.cli;

import com.wissen.pricealert.engine.AlertEngine;
import com.wissen.pricealert.io.PriceCsvReader;
import com.wissen.pricealert.io.RuleJsonReader;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;

public final class PriceAlertCli {

    private static final String USAGE =
            "Usage: java -jar price-alert-tool-1.0-SNAPSHOT.jar <prices.csv> <rules.json>";

    private final PriceCsvReader priceCsvReader = new PriceCsvReader();
    private final RuleJsonReader ruleJsonReader = new RuleJsonReader();
    private final AlertEngine alertEngine = new AlertEngine();
    private final AlertFormatter alertFormatter = new AlertFormatter();

    public int run(String[] args, PrintStream out, PrintStream err) {
        if (args == null || args.length != 2) {
            err.println(USAGE);
            return 2;
        }

        try {
            Path pricesPath = readableFile(args[0], "prices CSV");
            Path rulesPath = readableFile(args[1], "rules JSON");
            var records = priceCsvReader.read(pricesPath);
            var rules = ruleJsonReader.read(rulesPath);
            var alerts = alertEngine.evaluate(records, rules);
            out.println(alertFormatter.format(alerts));
            return 0;
        } catch (IOException | IllegalArgumentException e) {
            err.println("Error: " + e.getMessage());
            return 1;
        }
    }

    private static Path readableFile(String value, String description) throws IOException {
        final Path path;
        try {
            path = Path.of(value);
        } catch (InvalidPathException e) {
            throw new IOException("Invalid " + description + " path '" + value + "'");
        }
        if (!Files.isRegularFile(path) || !Files.isReadable(path)) {
            throw new IOException(description + " file does not exist or is not readable: " + path);
        }
        return path;
    }
}
