package com.wissen.pricealert;

import com.wissen.pricealert.cli.PriceAlertCli;

public final class Main {

    private Main() {
    }

    public static void main(String[] args) {
        int exitCode = new PriceAlertCli().run(args, System.out, System.err);
        if (exitCode != 0) {
            System.exit(exitCode);
        }
    }
}
