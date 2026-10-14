package com.wissen.pricealert.io;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("csv")
@Tag("validation")
class PriceCsvReaderTest {

    @TempDir
    Path tempDir;

    private final PriceCsvReader reader = new PriceCsvReader();

    @Test
    void parsesValidUnorderedCsvAndPreservesInputOrder() throws IOException {
        Path file = write("\uFEFFdate,instrument,close\n"
                + "2026-01-02,ABC,11.25\n"
                + "2026-01-01,ABC,10.00\n");

        var records = reader.read(file);

        assertEquals(2, records.size());
        assertEquals("11.25", records.get(0).close().toPlainString());
        assertEquals(List.of("2026-01-02", "2026-01-01"),
                records.stream().map(record -> record.date().toString()).toList());
    }

    @Test
    void rejectsMissingRequiredHeaders() throws IOException {
        Path file = write("date,instrument\n2026-01-01,ABC\n");

        var error = assertThrows(IOException.class, () -> reader.read(file));

        assertEquals(true, error.getMessage().contains("close"));
        assertEquals(true, error.getMessage().contains("required headers"));
    }

    @Test
    void rejectsMalformedValuesWithRecordContext() throws IOException {
        Path badDate = write("date,instrument,close\nnot-a-date,ABC,10\n");
        var dateError = assertThrows(IOException.class, () -> reader.read(badDate));
        assertEquals(true, dateError.getMessage().contains("record 1"));
        assertEquals(true, dateError.getMessage().contains("date"));

        Path badPrice = write("date,instrument,close\n2026-01-01,ABC,0\n");
        var priceError = assertThrows(IOException.class, () -> reader.read(badPrice));
        assertEquals(true, priceError.getMessage().contains("record 1"));
        assertEquals(true, priceError.getMessage().contains("positive"));
    }

    @Test
    void rejectsBlankAndMissingColumns() throws IOException {
        Path blank = write("date,instrument,close\n2026-01-01, ,10\n");
        assertEquals(true, assertThrows(IOException.class, () -> reader.read(blank))
                .getMessage().contains("instrument"));

        Path missingColumn = write("date,instrument,close\n2026-01-01,ABC\n");
        assertEquals(true, assertThrows(IOException.class, () -> reader.read(missingColumn))
                .getMessage().contains("expected 3 columns"));
    }

    @Test
    void rejectsMalformedCsvQuoting() throws IOException {
        Path file = write("date,instrument,close\n"
                + "\"2026-01-01,ABC,10\n");

        var error = assertThrows(IOException.class, () -> reader.read(file));

        assertEquals(true, error.getMessage().contains("Malformed CSV"));
        assertEquals(true, error.getMessage().contains("EOF reached"));
    }

    private Path write(String content) throws IOException {
        Path file = tempDir.resolve("prices-" + UUID.randomUUID() + ".csv");
        return Files.writeString(file, content);
    }
}
