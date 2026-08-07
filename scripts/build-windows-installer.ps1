$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$output = if ($args.Count -gt 0) { [IO.Path]::GetFullPath($args[0]) } else { Join-Path $root "Wallet-Setup.exe" }
$sevenZip = "C:\Program Files\7-Zip\7z.exe"
$sfxModule = "C:\Program Files\7-Zip\7z.sfx"
$nodeRuntime = "C:\Program Files\nodejs\node.exe"

foreach ($required in @($sevenZip, $sfxModule, $nodeRuntime, (Join-Path $root "out"), (Join-Path $root "installer\server.mjs"), (Join-Path $root "installer\launch.vbs"))) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Required installer input was not found: $required"
  }
}

$buildId = [guid]::NewGuid().ToString("N")
$payload = Join-Path $env:TEMP "wallet-installer-payload-$buildId"
$archive = Join-Path $env:TEMP "wallet-installer-$buildId.7z"
$outputDirectory = Split-Path -Parent $output

New-Item -ItemType Directory -Path (Join-Path $payload "site") -Force | Out-Null
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Copy-Item -Path (Join-Path $root "out\*") -Destination (Join-Path $payload "site") -Recurse -Force
Copy-Item -LiteralPath $nodeRuntime -Destination (Join-Path $payload "node.exe") -Force
Copy-Item -LiteralPath (Join-Path $root "installer\server.mjs") -Destination $payload -Force
Copy-Item -LiteralPath (Join-Path $root "installer\launch.vbs") -Destination $payload -Force

& $sevenZip a -t7z -mx=9 -mmt=on $archive (Join-Path $payload "*") | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "7-Zip failed while creating the installer archive."
}

$parts = @($sfxModule, (Join-Path $root "installer\sfx-config.txt"), $archive)
$outputStream = [IO.File]::Open($output, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  foreach ($part in $parts) {
    $inputStream = [IO.File]::OpenRead($part)
    try {
      $inputStream.CopyTo($outputStream)
    } finally {
      $inputStream.Dispose()
    }
  }
} finally {
  $outputStream.Dispose()
}

$sizeMb = [Math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 2)
Write-Output "Created $output ($sizeMb MB)"
