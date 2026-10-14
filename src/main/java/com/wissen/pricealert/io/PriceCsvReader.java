package com.wissen.pricealert.io;

import com.wissen.pricealert.domain.PriceRecord;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

public final class PriceCsvReader {

    private static final Set<String> REQUIRED_HEADERS = Set.of("date", "instrument", "close");

    public List<PriceRecord> read(Path path) throws IOException {
        try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            reader.mark(1);
            if (reader.read() != '\uFEFF') {
                reader.reset();
            }
            try (CSVParser parser = CSVFormat.DEFAULT.builder()
                    .setHeader()
                    .setSkipHeaderRecord(true)
                    .setIgnoreEmptyLines(false)
                    .get()
                    .parse(reader)) {
                validateHeaders(parser.getHeaderMap(), path);
                var records = new ArrayList<PriceRecord>();
                try {
                    for (CSVRecord row : parser) {
                        if (!row.isConsistent()) {
                            throw rowError(row, "expected " + parser.getHeaderMap().size()
                                    + " columns but found " + row.size());
                        }

                        String date = requiredValue(row, "date");
                        String instrument = requiredValue(row, "instrument");
                        String close = requiredValue(row, "close");
                        try {
                            records.add(new PriceRecord(
                                    LocalDate.parse(date),
                                    instrument,
                                    new BigDecimal(close)));
                        } catch (DateTimeParseException e) {
                            throw rowError(row, "field 'date' must use ISO format YYYY-MM-DD: "
                                    + date);
                        } catch (NumberFormatException e) {
                            throw rowError(row, "field 'close' must be a valid decimal: " + close);
                        } catch (IllegalArgumentException e) {
                            throw rowError(row, e.getMessage());
                        }
                    }
                } catch (UncheckedIOException e) {
                    throw new IOException("Malformed CSV in '" + path + "': "
                            + e.getCause().getMessage(), e.getCause());
                }
                return List.copyOf(records);
            }
        } catch (IOException e) {
            throw new IOException("Could not read prices CSV '" + path + "': "
                    + e.getMessage(), e);
        }
    }

    private static void validateHeaders(Map<String, Integer> headers, Path path)
            throws IOException {
        if (headers == null || !headers.keySet().containsAll(REQUIRED_HEADERS)) {
            Set<String> found = headers == null ? Set.of() : headers.keySet();
            var missing = new java.util.TreeSet<>(REQUIRED_HEADERS);
            missing.removeAll(found);
            throw new IOException("Prices CSV '" + path
                    + "' is missing required headers: " + String.join(", ", missing));
        }
    }

    private static String requiredValue(CSVRecord row, String field) throws IOException {
        String value = row.get(field);
        if (value == null || value.isBlank()) {
            throw rowError(row, "required field '" + field + "' is blank");
        }
        return value;
    }

    private static IOException rowError(CSVRecord row, String detail) {
        return new IOException("CSV record " + row.getRecordNumber() + ": " + detail);
    }
}
