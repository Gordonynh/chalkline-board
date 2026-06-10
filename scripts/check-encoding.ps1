param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

function New-TextFromCodePoints {
  param([int[]]$CodePoints)
  return [string]::Concat(($CodePoints | ForEach-Object { [char]$_ }))
}

$badPatterns = @(
  ('?' * 4),
  (New-TextFromCodePoints @(0xFFFD)),
  (New-TextFromCodePoints @(0x59DD)),
  (New-TextFromCodePoints @(0x935A)),
  (New-TextFromCodePoints @(0x93C1, 0x6B10)),
  (New-TextFromCodePoints @(0x6B63, 0x5728, 0x9354)),
  (New-TextFromCodePoints @(0x8BF7, 0x98CE))
)

$textExtensions = @(
  '.ts', '.tsx', '.css', '.html', '.md', '.txt', '.json', '.xaml',
  '.cs', '.csproj', '.props', '.cmd', '.iss', '.mjs', '.js', '.ps1'
)
$excludedDirs = @('node_modules', 'dist', 'dist-desktop', 'dist-visualizer', 'dist-visualizer-web', 'bin', 'obj', '.git')
$failed = $false

Get-ChildItem -LiteralPath $Root -Recurse -File |
  Where-Object {
    $parts = $_.FullName.Substring($Root.TrimEnd('\', '/').Length) -split '[\\/]'
    -not ($parts | Where-Object { $excludedDirs -contains $_ }) -and
      ($textExtensions -contains $_.Extension.ToLowerInvariant())
  } |
  ForEach-Object {
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $utf8Strict = [System.Text.UTF8Encoding]::new($false, $true)
    try {
      $text = $utf8Strict.GetString($bytes)
    } catch {
      Write-Error "Invalid UTF-8: $($_.FullName)"
      $script:failed = $true
      return
    }

    foreach ($pattern in $badPatterns) {
      if ($text.Contains($pattern)) {
        Write-Error "Possible mojibake detected: $($_.FullName)"
        $script:failed = $true
        break
      }
    }
  }

if ($failed) {
  exit 1
}

Write-Host "Encoding check passed: $Root"
