$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$JarPath = Join-Path $ProjectRoot "target\price-alert-tool-1.0-SNAPSHOT.jar"
$script:LastExitCode = 0
$script:LastOutput = ""
$script:DetailedLogs = $false
$script:LatestTestReports = @()
$script:LatestTestReport = $null

function Write-Heading {
    param([string]$Title)

    Write-Host ""
    Write-Host "============================================================"
    Write-Host " $Title"
    Write-Host "============================================================"
}

function Pause-Runner {
    [void](Read-Host "Press Enter to continue")
}

function Read-MenuSelection {
    param(
        [string]$Prompt,
        [string[]]$ValidOptions
    )

    while ($true) {
        $selection = Read-Host $Prompt
        if ($ValidOptions -contains $selection) {
            return $selection
        }
        Write-Host "Invalid selection. Choose one of: $($ValidOptions -join ', ')."
    }
}

function Get-ToolCommand {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "$Name was not found on PATH. Install it and open a new PowerShell window."
    }
    return $command
}

function Save-CommandLog {
    param(
        [string]$Name,
        [string[]]$Lines
    )

    $logDirectory = Join-Path $ProjectRoot "target\test-runner-logs"
    if (-not (Test-Path -LiteralPath $logDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    }
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $logPath = Join-Path $logDirectory "$Name-$timestamp.log"
    [System.IO.File]::WriteAllLines($logPath, $Lines, [System.Text.Encoding]::UTF8)
    return $logPath
}

function Invoke-Maven {
    param(
        [string[]]$Arguments,
        [switch]$Quiet
    )

    $maven = Get-ToolCommand "mvn"
    $operation = "mvn $($Arguments -join ' ')"
    if (-not $Quiet) {
        Write-Heading $operation
        Write-Host "Status: Maven is running..."
    }
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = @(& $maven.Source @Arguments 2>&1)
        $script:LastExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    $lines = @($output | ForEach-Object { $_.ToString() })
    $script:LastOutput = $lines -join [Environment]::NewLine
    $script:LastLogPath = Save-CommandLog "maven" $lines
    if ($script:DetailedLogs -and -not $Quiet) {
        $lines | ForEach-Object { Write-Host $_ }
        Write-Host "Full log saved to: $script:LastLogPath"
    }
    if (-not $Quiet) {
        Write-Host "Maven exit code: $script:LastExitCode"
    }
}

function Get-TestReportSnapshot {
    $snapshot = @{}
    $reportDirectory = Join-Path $ProjectRoot "target\surefire-reports"
    if (Test-Path -LiteralPath $reportDirectory -PathType Container) {
        Get-ChildItem -LiteralPath $reportDirectory -Filter "TEST-*.xml" -File |
            ForEach-Object {
                $snapshot[$_.FullName] = "{0}:{1}" -f $_.LastWriteTimeUtc.Ticks, $_.Length
            }
    }
    return $snapshot
}

function Get-ChangedTestReports {
    param([hashtable]$Before)

    $reportDirectory = Join-Path $ProjectRoot "target\surefire-reports"
    if (-not (Test-Path -LiteralPath $reportDirectory -PathType Container)) {
        return @()
    }
    $changed = @()
    Get-ChildItem -LiteralPath $reportDirectory -Filter "TEST-*.xml" -File |
        ForEach-Object {
            $signature = "{0}:{1}" -f $_.LastWriteTimeUtc.Ticks, $_.Length
            if (-not $Before.ContainsKey($_.FullName) -or $Before[$_.FullName] -ne $signature) {
                $changed += $_.FullName
            }
        }
    return $changed
}

function Read-TestReports {
    param([string[]]$Paths)

    $result = [ordered]@{
        Reliable = $false
        Total = 0
        Passed = 0
        Failed = 0
        Errors = 0
        Skipped = 0
        Tests = @()
        Message = ""
        Reports = @()
    }
    if ($Paths.Count -eq 0) {
        $result.Message = "No new Surefire XML reports were produced; counts are unavailable."
        return [pscustomobject]$result
    }

    try {
        foreach ($path in $Paths) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
                throw "Surefire report is missing: $path"
            }
            [xml]$report = [System.IO.File]::ReadAllText($path)
            $suite = $report.DocumentElement
            if ($null -eq $suite -or $suite.LocalName -ne "testsuite") {
                throw "Unexpected Surefire report format in $path"
            }
            $tests = [int]$suite.GetAttribute("tests")
            $failures = [int]$suite.GetAttribute("failures")
            $errors = [int]$suite.GetAttribute("errors")
            $skipped = [int]$suite.GetAttribute("skipped")
            $cases = @($suite.SelectNodes("testcase"))
            $suitePassed = 0
            $suiteFailed = 0
            $suiteErrors = 0
            $suiteSkipped = 0
            foreach ($case in $cases) {
                $failure = $case.SelectSingleNode("failure")
                $errorNode = $case.SelectSingleNode("error")
                $skipNode = $case.SelectSingleNode("skipped")
                $status = "PASS"
                $detail = ""
                $expectedActual = ""
                $exception = ""
                if ($null -ne $failure) {
                    $status = "FAIL"
                    $suiteFailed++
                    $detail = $failure.GetAttribute("message")
                    $exception = $failure.GetAttribute("type")
                    if ([string]::IsNullOrWhiteSpace($detail)) {
                        $detail = ($failure.InnerText -split "[`r`n]")[0].Trim()
                    }
                    if ([string]::IsNullOrWhiteSpace($exception)) {
                        $exception = ($failure.InnerText -split "[`r`n]")[0].Trim()
                    }
                    if ($failure.InnerText -match '(?is)expected\s*[:=]\s*(.+?)\s+(?:but\s+)?actual\s*[:=]\s*(.+?)(?:\r?\n|$)') {
                        $expectedActual = "Expected: $($matches[1].Trim()); actual: $($matches[2].Trim())"
                    } elseif ($failure.InnerText -match '(?is)expected\s*[:=]\s*(.+?)\s+but\s+was\s*[:=]?\s*(.+?)(?:\r?\n|$)') {
                        $expectedActual = "Expected: $($matches[1].Trim()); actual: $($matches[2].Trim())"
                    }
                } elseif ($null -ne $errorNode) {
                    $status = "ERROR"
                    $suiteErrors++
                    $detail = $errorNode.GetAttribute("message")
                    $exception = $errorNode.GetAttribute("type")
                    if ([string]::IsNullOrWhiteSpace($detail)) {
                        $detail = ($errorNode.InnerText -split "[`r`n]")[0].Trim()
                    }
                    if ([string]::IsNullOrWhiteSpace($exception)) {
                        $exception = ($errorNode.InnerText -split "[`r`n]")[0].Trim()
                    }
                } elseif ($null -ne $skipNode) {
                    $status = "SKIP"
                    $suiteSkipped++
                    $detail = $skipNode.GetAttribute("message")
                } else {
                    $suitePassed++
                }
                $result.Tests += [pscustomobject]@{
                    Class = $case.GetAttribute("classname")
                    Method = $case.GetAttribute("name")
                    Status = $status
                    Detail = $detail
                    ExpectedActual = $expectedActual
                    Exception = $exception
                }
            }
            if ($cases.Count -ne $tests -or $suitePassed + $suiteFailed + $suiteErrors + $suiteSkipped -ne $tests -or
                $suiteFailed -ne $failures -or $suiteErrors -ne $errors -or $suiteSkipped -ne $skipped) {
                throw "Inconsistent test totals in $path (suite reports $tests tests, testcase details found $($cases.Count))."
            }
            $result.Total += $tests
            $result.Passed += $suitePassed
            $result.Failed += $suiteFailed
            $result.Errors += $suiteErrors
            $result.Skipped += $suiteSkipped
            $result.Reports += $path
        }
        if ($result.Total -eq 0) {
            $result.Reliable = $true
            $result.Message = "Surefire reports were verified, but no tests were executed."
            return [pscustomobject]$result
        }
        $result.Reliable = $true
        $result.Message = "Counts read from newly generated Surefire reports."
    } catch {
        $result.Message = "Could not verify Surefire reports: $($_.Exception.Message)"
    }
    return [pscustomobject]$result
}

function Show-TestSummary {
    param(
        [string]$Category,
        [string]$Command,
        [int]$ExitCode,
        [pscustomobject]$Report
    )

    Write-Heading "Technical Test Report"
    Write-Host "Category: $Category"
    Write-Host "Command:  $Command"
    $status = "INCOMPLETE"
    if ($ExitCode -ne 0) {
        $status = "FAIL"
    } elseif ($Report.Reliable -and ($Report.Failed -gt 0 -or $Report.Errors -gt 0)) {
        $status = "FAIL"
    } elseif ($Report.Reliable -and $Report.Total -gt 0) {
        $status = "PASS"
    }
    Write-Host "Overall:  $status (Maven exit code $ExitCode)"
    if ($Report.Reliable) {
        $percentage = if ($Report.Total -gt 0) {
            [math]::Round(($Report.Passed * 100.0) / $Report.Total, 1)
        } else {
            0.0
        }
        Write-Host ("Tests: total {0}, passed {1}, failed {2}, errors {3}, skipped {4}, pass rate {5:N1}%" -f `
            $Report.Total, $Report.Passed, $Report.Failed, $Report.Errors, $Report.Skipped, $percentage)
        Write-Host $Report.Message
        Write-Host ""
        Write-Host ("{0,-7} {1,-55} {2}" -f "RESULT", "TEST CLASS", "METHOD")
        Write-Host ("{0,-7} {1,-55} {2}" -f "-------", ("-" * 55), "------------------------------")
        foreach ($test in $Report.Tests) {
            Write-Host ("{0,-7} {1,-55} {2}" -f $test.Status, $test.Class, $test.Method)
            if ($test.Status -eq "FAIL" -or $test.Status -eq "ERROR") {
                if (-not [string]::IsNullOrWhiteSpace($test.Detail)) {
                    Write-Host "        Message: $($test.Detail)"
                }
                if (-not [string]::IsNullOrWhiteSpace($test.ExpectedActual)) {
                    Write-Host "        $($test.ExpectedActual)"
                }
                if (-not [string]::IsNullOrWhiteSpace($test.Exception)) {
                    Write-Host "        Exception: $($test.Exception)"
                }
            }
        }
        Write-Host ""
        foreach ($path in $Report.Reports) {
            Write-Host "Surefire report: $path"
        }
        if ($ExitCode -ne 0) {
            if ($Report.Failed -gt 0 -or $Report.Errors -gt 0) {
                Write-Host "Failure type: Surefire recorded test failures or execution errors."
            } elseif ($script:LastOutput -match '(?i)compilation failure|compilation error|cannot find symbol|error compiling') {
                Write-Host "Failure type: Maven compilation/build failure; the parsed tests did not report a test failure."
            } else {
                Write-Host "Failure type: Maven command failed even though the available test cases are reported."
            }
        }
    } else {
        Write-Host "Tests: total N/A, passed N/A, failed N/A, errors N/A, skipped N/A, pass rate N/A"
        Write-Host "Report status: $($Report.Message)"
        if ($Report.Tests.Count -gt 0) {
            Write-Host "Available testcase details (not verified against complete totals):"
            foreach ($test in $Report.Tests) {
                Write-Host ("{0,-7} {1,-55} {2}" -f $test.Status, $test.Class, $test.Method)
                if (($test.Status -eq "FAIL" -or $test.Status -eq "ERROR") -and
                    -not [string]::IsNullOrWhiteSpace($test.Detail)) {
                    Write-Host "        Message: $($test.Detail)"
                }
                if (-not [string]::IsNullOrWhiteSpace($test.ExpectedActual)) {
                    Write-Host "        $($test.ExpectedActual)"
                }
                if (-not [string]::IsNullOrWhiteSpace($test.Exception)) {
                    Write-Host "        Exception: $($test.Exception)"
                }
            }
        }
        foreach ($path in $Report.Reports) {
            Write-Host "Available Surefire report: $path"
        }
        if ($ExitCode -ne 0) {
            if ($script:LastOutput -match '(?i)compilation failure|compilation error|cannot find symbol|error compiling') {
                Write-Host "Failure type: compilation/build failure."
            } elseif ($script:LastOutput -match '(?i)there are test failures|test failures') {
                Write-Host "Failure type: Maven reported test failures, but usable Surefire details are unavailable."
            } else {
                Write-Host "Maven failed before test results could be verified."
            }
        }
    }
    Write-Host "Detailed Maven log: $script:LastLogPath"
    Write-Host "Set Detailed Logs to on or open the log above to view full output and stack traces."
}

function Run-TestOperation {
    param(
        [string]$Name,
        [string[]]$Arguments
    )

    $command = "mvn $($Arguments -join ' ')"
    $before = Get-TestReportSnapshot
    $script:LatestTestReports = @()
    Invoke-Maven $Arguments
    $script:LatestTestReports = @(Get-ChangedTestReports $before)
    $report = Read-TestReports $script:LatestTestReports
    if ($script:LastExitCode -eq 0 -and -not $report.Reliable) {
        $report.Message = "Maven exited successfully, but test reports are missing or could not be verified: $($report.Message)"
    }
    if ($report.Reliable) {
        $resultLine = @($script:LastOutput -split "`r?`n" | Where-Object {
            $_ -match '^\[INFO\]\s+Tests run:\s+\d+,\s+Failures:\s+\d+,\s+Errors:\s+\d+,\s+Skipped:\s+\d+\s*$'
        } | Select-Object -Last 1)
        if ($resultLine.Count -eq 0 -or $resultLine[0] -notmatch 'Tests run:\s+(\d+),\s+Failures:\s+(\d+),\s+Errors:\s+(\d+),\s+Skipped:\s+(\d+)') {
            $report.Reliable = $false
            $report.Message = "Maven's aggregate test summary is missing; report completion is inconsistent."
        } else {
            $mavenCounts = $matches
            if ([int]$mavenCounts[1] -ne $report.Total -or
                [int]$mavenCounts[2] -ne $report.Failed -or
                [int]$mavenCounts[3] -ne $report.Errors -or
                [int]$mavenCounts[4] -ne $report.Skipped) {
                $report.Reliable = $false
                $report.Message = "Surefire report totals do not match Maven's aggregate test summary."
            }
        }
    }
    $script:LatestTestReport = $report
    Show-TestSummary $Name $command $script:LastExitCode $report
    $status = "INCOMPLETE"
    if ($script:LastExitCode -ne 0 -or
        ($report.Reliable -and ($report.Failed -gt 0 -or $report.Errors -gt 0))) {
        $status = "FAIL"
    } elseif ($report.Reliable -and $report.Total -gt 0) {
        $status = "PASS"
    }
    $script:LatestTestReport = [pscustomobject]@{
        Category = $Name
        Command = $command
        Status = $status
        Reliable = $report.Reliable
        Data = $report
        LogPath = $script:LastLogPath
        ExitCode = $script:LastExitCode
    }
    return ($script:LastExitCode -eq 0 -and $report.Reliable -and
        $report.Total -gt 0 -and $report.Failed -eq 0 -and $report.Errors -eq 0)
}

function Ensure-PackagedJar {
    param([switch]$Quiet)

    $null = Get-ToolCommand "java"
    $jarIsStale = -not (Test-Path -LiteralPath $JarPath -PathType Leaf)
    if (-not $jarIsStale) {
        $jarTime = (Get-Item -LiteralPath $JarPath).LastWriteTimeUtc
        $latestSourceTime = (Get-Item -LiteralPath (Join-Path $ProjectRoot "pom.xml")).LastWriteTimeUtc
        $sourceFiles = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "src") -Recurse -File
        foreach ($sourceFile in $sourceFiles) {
            if ($sourceFile.LastWriteTimeUtc -gt $latestSourceTime) {
                $latestSourceTime = $sourceFile.LastWriteTimeUtc
            }
        }
        $jarIsStale = $latestSourceTime -gt $jarTime
    }
    if ($jarIsStale) {
        if ($Quiet) {
            Write-Host "Status: Preparing the application..."
            Invoke-Maven @("package") -Quiet
        } else {
            Write-Host "Status: Preparing the executable application..."
            Invoke-Maven @("package")
        }
        if ($script:LastExitCode -ne 0) {
            if ($Quiet) {
                Write-Host "The application could not be prepared. Check Maven and Java setup."
            } else {
                Write-Host "Application preparation failed. See log: $script:LastLogPath"
            }
            return $false
        }
    }
    if (-not (Test-Path -LiteralPath $JarPath -PathType Leaf)) {
        Write-Host "Application JAR was not created: $JarPath"
        return $false
    }
    return $true
}

function Invoke-PriceAlertJar {
    param(
        [string]$PricesPath,
        [string]$RulesPath
    )

    $java = Get-ToolCommand "java"
    if ($script:DetailedLogs) {
        Write-Host "Command: java -jar `"$JarPath`" `"$PricesPath`" `"$RulesPath`""
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $java.Source
    $startInfo.Arguments = '-jar "{0}" "{1}" "{2}"' -f $JarPath, $PricesPath, $RulesPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "Could not start Java executable: $($java.Source)"
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $script:LastStdOut = $stdoutTask.Result
        $script:LastStdErr = $stderrTask.Result
        $script:LastExitCode = $process.ExitCode
        $script:LastOutput = $script:LastStdOut + [Environment]::NewLine + $script:LastStdErr
    } finally {
        $process.Dispose()
    }
}

function Get-AlertLines {
    param([string]$Output)

    $lines = @()
    foreach ($line in ($Output -split "`r?`n")) {
        if ($line -match '^\d{4}-\d{2}-\d{2}\s+\|') {
            $lines += $line.Trim()
        }
    }
    return $lines
}

function Show-ApplicationSummary {
    param(
        [string]$PricesPath,
        [string]$RulesPath
    )

    Write-Heading "Price Alert Analysis"
    Write-Host "Prices file: $([System.IO.Path]::GetFileName($PricesPath))"
    Write-Host "Rules file:  $([System.IO.Path]::GetFileName($RulesPath))"
    $alerts = @(Get-AlertLines $script:LastStdOut)
    if ($script:LastExitCode -eq 0) {
        if ($alerts.Count -gt 0) {
            Write-Host "Status: Analysis completed - configured alert conditions were met"
            Write-Host "Alerts: $($alerts.Count)"
            foreach ($alert in $alerts) {
                Write-Host "  $alert"
            }
            Write-Host "Meaning: The listed rule conditions occurred in the supplied historical data."
        } elseif ($script:LastStdOut -match "No alerts generated\.") {
            Write-Host "Status: Analysis completed - no configured conditions were triggered"
            Write-Host "Alerts: 0"
            Write-Host "Meaning: No configured rule was met by the supplied data."
        } else {
            Write-Host "Status: Application completed, but returned no recognizable alert summary."
            Write-Host "Alerts: Cannot determine"
        }
    } elseif ($script:LastOutput -match '(?m)^(Error:|Usage:)') {
        Write-Host "Status: Invalid input (application exit code $script:LastExitCode)"
        $errorMessage = ($script:LastOutput -split "`r?`n" | Where-Object {
            $_ -match '^(Error:|Usage:)'
        } | Select-Object -First 1)
        if ($errorMessage -match '^Error:\s*(.*)$') {
            Write-Host "Problem: $($matches[1])"
            Write-Host "Next step: Check that both files exist and that the CSV and JSON follow the documented formats."
        } else {
            Write-Host "Problem: The application received invalid command-line input."
            Write-Host "Next step: Provide a prices CSV file and a rules JSON file."
        }
    } else {
        Write-Host "Status: Application failure (exit code $script:LastExitCode)"
        Write-Host "Problem: The application did not complete the analysis."
        Write-Host "Next step: Check the input files and try again."
    }
    if ($script:LastExitCode -eq 0 -and $alerts.Count -gt 0) {
        Write-Host "Note: An alert only indicates that a configured rule was met; it does not predict future prices."
    }
    Write-Host "Application exit code: $script:LastExitCode"
}

function Run-CustomFiles {
    if (-not (Ensure-PackagedJar -Quiet)) {
        return
    }
    $pricesPath = Read-Host "Enter the full path to the prices CSV"
    $rulesPath = Read-Host "Enter the full path to the rules JSON"
    try {
        Invoke-PriceAlertJar $pricesPath $rulesPath
        Show-ApplicationSummary $pricesPath $rulesPath
    } catch {
        Write-Host "Application could not be started: $($_.Exception.Message)"
        Write-Host "Application exit code: not available"
    }
}

function Write-ScenarioFiles {
    param(
        [string]$Directory,
        [string]$Name,
        [string]$PricesCsv,
        [string]$RulesJson
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    $pricesPath = Join-Path $Directory "$Name-prices.csv"
    $rulesPath = Join-Path $Directory "$Name-rules.json"
    [System.IO.File]::WriteAllText($pricesPath, $PricesCsv, $encoding)
    [System.IO.File]::WriteAllText($rulesPath, $RulesJson, $encoding)
    return @($pricesPath, $rulesPath)
}

function Test-ExpectedScenario {
    param(
        [string]$Name,
        [string]$PricesPath,
        [string]$RulesPath,
        [bool]$ExpectSuccess,
        [string[]]$ExpectedOutput,
        [bool]$ShowOutput = $true
    )

    Write-Host "`n--- $Name ---"
    try {
        Invoke-PriceAlertJar $PricesPath $RulesPath
    } catch {
        Write-Host "FAIL - application could not be started: $($_.Exception.Message)"
        return $false
    }
    $exitPassed = if ($ExpectSuccess) { $script:LastExitCode -eq 0 } else { $script:LastExitCode -ne 0 }
    $missing = @($ExpectedOutput | Where-Object {
        $script:LastOutput.IndexOf($_, [System.StringComparison]::OrdinalIgnoreCase) -lt 0
    })
    if ($ShowOutput) {
        if (-not [string]::IsNullOrWhiteSpace($script:LastStdOut)) {
            Write-Host $script:LastStdOut.Trim()
        }
        if (-not [string]::IsNullOrWhiteSpace($script:LastStdErr)) {
            Write-Host $script:LastStdErr.Trim()
        }
        Write-Host "Application exit code: $script:LastExitCode"
    }
    if ($exitPassed -and $missing.Count -eq 0) {
        Write-Host "PASS - expected output and exit status verified."
        return $true
    }
    if (-not $exitPassed) {
        Write-Host "FAIL - exit status did not match the expected result."
    }
    foreach ($expected in $missing) {
        Write-Host "FAIL - output did not contain: $expected"
    }
    return $false
}

function Run-SampleScenarios {
    if (-not (Ensure-PackagedJar)) {
        return $false
    }
    $directory = Join-Path ([System.IO.Path]::GetTempPath()) (
        "price-alert-samples-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $directory | Out-Null
    $passedCount = 0
    $scenarioCount = 7
    try {
        $up = Write-ScenarioFiles $directory "upward" @"
date,instrument,close
2026-01-01,ABC,9.00
2026-01-02,ABC,11.00
"@ '[{"id":"UP","instrument":"ABC","type":"LEVEL","threshold":10}]'
        if (Test-ExpectedScenario "Upward level crossing" $up[0] $up[1] $true @("LEVEL_UP", "2026-01-02")) { $passedCount++ }

        $down = Write-ScenarioFiles $directory "downward" @"
date,instrument,close
2026-01-01,ABC,11.00
2026-01-02,ABC,9.00
"@ '[{"id":"DOWN","instrument":"ABC","type":"LEVEL","threshold":10}]'
        if (Test-ExpectedScenario "Downward level crossing" $down[0] $down[1] $true @("LEVEL_DOWN", "2026-01-02")) { $passedCount++ }

        $bullish = Write-ScenarioFiles $directory "bullish" @"
date,instrument,close
2026-01-01,ABC,10.00
2026-01-02,ABC,8.00
2026-01-03,ABC,9.00
"@ '[{"id":"BULL","instrument":"ABC","type":"MA_CROSS","shortWindow":1,"longWindow":2}]'
        if (Test-ExpectedScenario "Bullish moving-average crossover" $bullish[0] $bullish[1] $true @("MA_BULLISH", "2026-01-03")) { $passedCount++ }

        $bearish = Write-ScenarioFiles $directory "bearish" @"
date,instrument,close
2026-01-01,ABC,8.00
2026-01-02,ABC,10.00
2026-01-03,ABC,9.00
"@ '[{"id":"BEAR","instrument":"ABC","type":"MA_CROSS","shortWindow":1,"longWindow":2}]'
        if (Test-ExpectedScenario "Bearish moving-average crossover" $bearish[0] $bearish[1] $true @("MA_BEARISH", "2026-01-03")) { $passedCount++ }

        $none = Write-ScenarioFiles $directory "no-alerts" @"
date,instrument,close
2026-01-01,ABC,9.00
2026-01-02,ABC,11.00
"@ '[{"id":"NONE","instrument":"ABC","type":"LEVEL","threshold":50}]'
        if (Test-ExpectedScenario "No alerts" $none[0] $none[1] $true @("No alerts generated.")) { $passedCount++ }

        $invalid = Write-ScenarioFiles $directory "invalid" @"
date,instrument,close
2026-01-01,ABC,not-a-price
"@ "[]"
        if (Test-ExpectedScenario "Invalid input" $invalid[0] $invalid[1] $false @("Error:", "field 'close' must be a valid decimal")) { $passedCount++ }

        $missingPrices = Join-Path $directory "missing-prices.csv"
        if (Test-ExpectedScenario "Missing input file" $missingPrices $none[1] $false @("Error:", "prices CSV file does not exist or is not readable")) { $passedCount++ }
    } finally {
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
    if ($passedCount -eq $scenarioCount) {
        Write-Host "`nPASS - all $scenarioCount predefined scenarios passed."
        return $true
    }
    Write-Host "`nFAIL - $passedCount of $scenarioCount predefined scenarios passed."
    return $false
}

function Run-UserSample {
    if (-not (Ensure-PackagedJar -Quiet)) {
        return
    }
    Write-Heading "Choose a Sample Scenario"
    Write-Host "1. Price rises above a level"
    Write-Host "2. Price falls below a level"
    Write-Host "3. Short average crosses above long average"
    Write-Host "4. Short average crosses below long average"
    Write-Host "5. No rule condition is met"
    $choice = Read-MenuSelection "Select a sample (1-5)" @("1", "2", "3", "4", "5")
    $directory = Join-Path ([System.IO.Path]::GetTempPath()) (
        "price-alert-example-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $directory | Out-Null
    try {
        switch ($choice) {
            "1" {
                $scenario = "Upward level crossing"
                $condition = "Checks whether ABC closes above 10 after being at or below 10."
                $observed = "ABC closes: 9.00 on 2026-01-01; 11.00 on 2026-01-02."
                $csv = @"
date,instrument,close
2026-01-01,ABC,9.00
2026-01-02,ABC,11.00
"@
                $json = '[{"id":"EXAMPLE","instrument":"ABC","type":"LEVEL","direction":"above","level":10}]'
            }
            "2" {
                $scenario = "Downward level crossing"
                $condition = "Checks whether ABC closes below 10 after being at or above 10."
                $observed = "ABC closes: 11.00 on 2026-01-01; 9.00 on 2026-01-02."
                $csv = @"
date,instrument,close
2026-01-01,ABC,11.00
2026-01-02,ABC,9.00
"@
                $json = '[{"id":"EXAMPLE","instrument":"ABC","type":"LEVEL","direction":"below","level":10}]'
            }
            "3" {
                $scenario = "Bullish moving-average crossover"
                $condition = "Checks when ABC's 1-observation average crosses above its 2-observation average."
                $observed = "ABC closes: 10.00 on Jan 1, 8.00 on Jan 2, and 9.00 on Jan 3, 2026."
                $csv = @"
date,instrument,close
2026-01-01,ABC,10.00
2026-01-02,ABC,8.00
2026-01-03,ABC,9.00
"@
                $json = '[{"id":"EXAMPLE","instrument":"ABC","type":"MA_CROSS","short":1,"long":2,"direction":"above"}]'
            }
            "4" {
                $scenario = "Bearish moving-average crossover"
                $condition = "Checks when ABC's 1-observation average crosses below its 2-observation average."
                $observed = "ABC closes: 8.00 on Jan 1, 10.00 on Jan 2, and 9.00 on Jan 3, 2026."
                $csv = @"
date,instrument,close
2026-01-01,ABC,8.00
2026-01-02,ABC,10.00
2026-01-03,ABC,9.00
"@
                $json = '[{"id":"EXAMPLE","instrument":"ABC","type":"MA_CROSS","short":1,"long":2,"direction":"below"}]'
            }
            "5" {
                $scenario = "No alert"
                $condition = "Checks whether ABC crosses above 50."
                $observed = "ABC closes: 9.00 on 2026-01-01 and 11.00 on 2026-01-02; neither close is above 50."
                $csv = @"
date,instrument,close
2026-01-01,ABC,9.00
2026-01-02,ABC,11.00
"@
                $json = '[{"id":"EXAMPLE","instrument":"ABC","type":"LEVEL","direction":"above","level":50}]'
            }
        }
        $files = Write-ScenarioFiles $directory "example" $csv $json
        Write-Heading "Sample: $scenario"
        Write-Host "Condition: $condition"
        Write-Host "Observed input: $observed"
        Invoke-PriceAlertJar $files[0] $files[1]
        $alerts = @(Get-AlertLines $script:LastStdOut)
        if ($script:LastExitCode -eq 0 -and $alerts.Count -gt 0) {
            Write-Host "Result: The configured condition triggered."
            foreach ($alert in $alerts) {
                Write-Host "Alert: $alert"
                if ($alert -match '^\d{4}-\d{2}-\d{2}') {
                    Write-Host "Meaning: The configured condition was observed on $($matches[0])."
                }
            }
            Write-Host "Workflow: Review this rule-triggered date as part of your own monitoring process."
            Write-Host "This signal only reports a configured condition; it does not predict future prices."
        } elseif ($script:LastExitCode -eq 0 -and $script:LastStdOut -match "No alerts generated\.") {
            Write-Host "Result: No alert triggered; the configured condition was not met by these observations."
            Write-Host "Workflow: No rule-triggered event was found in this sample data."
        } else {
            Show-ApplicationSummary $files[0] $files[1]
        }
    } catch {
        Write-Host "Sample could not be completed. Check that Java is installed and the application is available."
    } finally {
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
}

function Show-RuleGuide {
    Write-Heading "How Alert Rules Work"
    Write-Host "A rule watches one instrument and produces an alert when its condition is met."
    Write-Host ""
    Write-Host "LEVEL: compares each close with a threshold. It can signal an upward or downward crossing."
    Write-Host "MA_CROSS: compares a short moving average with a longer one. It can signal bullish or bearish crossings."
    Write-Host "Official JSON uses level and direction (above/below), or short, long, and direction."
    Write-Host "Legacy JSON using threshold and shortWindow/longWindow is also supported."
    Write-Host "The CSV contains date, instrument, and close columns. Rules are stored in a JSON array."
}

function Show-LatestTestReport {
    if ($null -eq $script:LatestTestReport) {
        Write-Host "No verified test run is available in this session."
        return
    }
    Write-Heading "Latest Test Report"
    Write-Host "Category: $($script:LatestTestReport.Category)"
    Write-Host "Command:  $($script:LatestTestReport.Command)"
    Write-Host "Overall:  $($script:LatestTestReport.Status)"
    if ($script:LatestTestReport.Reliable) {
        $report = $script:LatestTestReport.Data
        $percentage = if ($report.Total -gt 0) {
            [math]::Round(($report.Passed * 100.0) / $report.Total, 1)
        } else {
            0.0
        }
        Write-Host ("Tests: total {0}, passed {1}, failed {2}, errors {3}, skipped {4}" -f `
            $report.Total, $report.Passed, $report.Failed, $report.Errors, $report.Skipped)
        Write-Host ("Pass rate: {0:N1}%" -f $percentage)
        foreach ($test in $report.Tests | Where-Object { $_.Status -eq "FAIL" -or $_.Status -eq "ERROR" }) {
            Write-Host "$($test.Status) $($test.Class).$($test.Method): $($test.Detail)"
            if ($test.ExpectedActual) { Write-Host "  $($test.ExpectedActual)" }
            if ($test.Exception) { Write-Host "  Exception: $($test.Exception)" }
        }
        foreach ($path in $report.Reports) {
            Write-Host "Surefire report: $path"
        }
    } else {
        Write-Host "Counts unavailable: $($script:LatestTestReport.Data.Message)"
    }
    Write-Host "Detailed Maven log: $($script:LatestTestReport.LogPath)"
    Write-Host "Enable Detailed Logs to display full output and stack traces on the next run."
}

function Show-UserMenu {
    Write-Heading "User Workspace"
    Write-Host "1. Run price alerts using custom CSV and JSON paths"
    Write-Host "2. Try a sample price-alert scenario"
    Write-Host "3. Learn how the alert rules work"
    Write-Host "4. Return to workspace selection"
    Write-Host "5. Exit"
}

function Show-AdminMenu {
    Write-Heading "Admin / Developer Workspace"
    Write-Host "1. Run all automated tests"
    Write-Host "2. Run engine tests"
    Write-Host "3. Run CSV tests"
    Write-Host "4. Run JSON tests"
    Write-Host "5. Run validation tests"
    Write-Host "6. Run CLI tests"
    Write-Host "7. Run all predefined scenarios"
    Write-Host "8. Run the application using custom files"
    Write-Host "9. Build the executable JAR"
    Write-Host "10. View the latest test report"
    Write-Host "11. Toggle detailed logs (currently $(@('off', 'on')[[int]$script:DetailedLogs]))"
    Write-Host "12. Return to workspace selection"
    Write-Host "13. Exit"
}

function Invoke-UserWorkspace {
    while ($true) {
        Show-UserMenu
        $choice = Read-MenuSelection "Select an option (1-5)" @("1", "2", "3", "4", "5")
        try {
            switch ($choice) {
                "1" { Run-CustomFiles; Pause-Runner }
                "2" { Run-UserSample; Pause-Runner }
                "3" { Show-RuleGuide; Pause-Runner }
                "4" { return }
                "5" { $script:ExitRequested = $true; return }
            }
        } catch {
            Write-Host "Unable to complete that action: $($_.Exception.Message)"
            Pause-Runner
        }
    }
}

function Invoke-AdminWorkspace {
    while ($true) {
        Show-AdminMenu
        $choice = Read-MenuSelection "Select an option (1-13)" @("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13")
        try {
            switch ($choice) {
                "1" { [void](Run-TestOperation "All automated tests" @("clean", "test")); Pause-Runner }
                "2" { [void](Run-TestOperation "Engine tests" @("test", "-DtestGroups=engine")); Pause-Runner }
                "3" { [void](Run-TestOperation "CSV tests" @("test", "-DtestGroups=csv")); Pause-Runner }
                "4" { [void](Run-TestOperation "JSON tests" @("test", "-DtestGroups=json")); Pause-Runner }
                "5" { [void](Run-TestOperation "Validation tests" @("test", "-DtestGroups=validation")); Pause-Runner }
                "6" { [void](Run-TestOperation "CLI tests" @("test", "-DtestGroups=cli")); Pause-Runner }
                "7" { [void](Run-SampleScenarios); Pause-Runner }
                "8" { Run-CustomFiles; Pause-Runner }
                "9" {
                    Invoke-Maven @("package")
                    if ($script:LastExitCode -eq 0 -and (Test-Path -LiteralPath $JarPath -PathType Leaf)) {
                        Write-Host "PASS - executable JAR created: $JarPath"
                    } else {
                        Write-Host "FAIL - JAR build failed or output JAR is missing."
                    }
                    Pause-Runner
                }
                "10" { Show-LatestTestReport; Pause-Runner }
                "11" {
                    $script:DetailedLogs = -not $script:DetailedLogs
                    Write-Host "Detailed logs are now $(@('off', 'on')[[int]$script:DetailedLogs])."
                }
                "12" { return }
                "13" { $script:ExitRequested = $true; return }
            }
        } catch {
            Write-Host "Unable to complete that action: $($_.Exception.Message)"
            Pause-Runner
        }
    }
}

function Show-Welcome {
    Write-Heading "Price Alert Tool"
    Write-Host "Choose a workspace."
    Write-Host "1. User Workspace"
    Write-Host "2. Admin / Developer Workspace"
    Write-Host "3. Exit"
}

function Test-AdminPasskey {
    $entered = Read-Host "Enter the developer passkey" -AsSecureString
    $expected = ConvertTo-SecureString "rks@1800" -AsPlainText -Force
    $enteredPointer = [IntPtr]::Zero
    $expectedPointer = [IntPtr]::Zero
    try {
        if ($entered.Length -ne $expected.Length) {
            return $false
        }
        $enteredPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($entered)
        $expectedPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($expected)
        for ($index = 0; $index -lt $entered.Length; $index++) {
            $enteredCharacter = [Runtime.InteropServices.Marshal]::ReadInt16($enteredPointer, $index * 2)
            $expectedCharacter = [Runtime.InteropServices.Marshal]::ReadInt16($expectedPointer, $index * 2)
            if ($enteredCharacter -ne $expectedCharacter) {
                return $false
            }
        }
        return $true
    } finally {
        if ($enteredPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($enteredPointer)
        }
        if ($expectedPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($expectedPointer)
        }
        $entered.Dispose()
        $expected.Dispose()
    }
}

$originalLocation = Get-Location
Set-Location -LiteralPath $ProjectRoot
try {
    $script:ExitRequested = $false
    while (-not $script:ExitRequested) {
        Show-Welcome
        $selection = Read-MenuSelection "Select a workspace (1-3)" @("1", "2", "3")
        switch ($selection) {
            "1" { Invoke-UserWorkspace }
            "2" {
                if (Test-AdminPasskey) {
                    Invoke-AdminWorkspace
                } else {
                    Write-Host "Access denied. Returning to workspace selection."
                }
            }
            "3" { $script:ExitRequested = $true }
        }
    }
    Write-Host "`nExiting Price Alert Tool."
} catch [System.Management.Automation.PipelineStoppedException] {
    Write-Host "`nInterrupted. Exiting the Price Alert Tool."
} catch {
    Write-Host "Unexpected error: $($_.Exception.Message)"
} finally {
    Set-Location -LiteralPath $originalLocation
}
