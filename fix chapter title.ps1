param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$InputPath,

    [Parameter(Position = 1)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
    throw "Input file not found: $InputPath"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $directory = Split-Path -Parent $InputPath
    $name = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
    $extension = [System.IO.Path]::GetExtension($InputPath)
    $OutputPath = Join-Path $directory "$name.fixed$extension"
}

$content = [System.IO.File]::ReadAllText($InputPath)
$newline = if ($content -match "`r`n") { "`r`n" } else { "`n" }
$lines = $content -split "\r?\n", -1

$fixed = New-Object System.Collections.Generic.List[string]
$changed = 0

for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]

    if ($line -match '^\s*((?:\u7B2C[\p{IsCJKUnifiedIdeographs}\u3007]+[\u5377\u7AE0]))\s*$') {
        $marker = $Matches[1]
        $j = $i + 1

        while ($j -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$j])) {
            $j++
        }

        if ($j -lt $lines.Count) {
            $title = $lines[$j].Trim()

            if ($title -notmatch '^\s*\u7B2C[\p{IsCJKUnifiedIdeographs}\u3007]+[\u5377\u7AE0](?:\s|$)') {
                $fixed.Add("$marker $title")
                $i = $j
                $changed++
                continue
            }
        }
    }

    $fixed.Add($line)
}

[System.IO.File]::WriteAllText($OutputPath, ($fixed -join $newline), [System.Text.UTF8Encoding]::new($false))

Write-Host "Done. Merged $changed heading pairs."
Write-Host "Output: $OutputPath"
