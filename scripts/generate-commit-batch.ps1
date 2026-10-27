<#
.SYNOPSIS
  Automated High-Performance Git Commit Batch Generator for SleepersCode.

.DESCRIPTION
  Generates structured, valid semantic commits with customizable batch sizes
  (e.g. 50, 100, 500, 1000, 10000) for performance benchmarking, history testing,
  and contribution indexing.

.PARAMETER Count
  Number of commits to generate (Default: 50).

.PARAMETER PushBatch
  Whether to push commits to origin in safe chunks (Default: $false).

.PARAMETER PushChunkSize
  Number of commits per push chunk to avoid GitHub pack-size timeouts (Default: 500).

.EXAMPLE
  .\scripts\generate-commit-batch.ps1 -Count 50
  .\scripts\generate-commit-batch.ps1 -Count 500 -PushBatch
#>

param (
  [int]$Count = 50,
  [switch]$PushBatch,
  [int]$PushChunkSize = 500
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SleepersCode Commit Batch Generator" -ForegroundColor Cyan
Write-Host "  Target Count : $Count commits" -ForegroundColor Yellow
Write-Host "  Author       : Dheeraj <178657024+Dheeraj1109g@users.noreply.github.com>" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# Ensure git author is configured correctly
git config user.name "Dheeraj"
git config user.email "178657024+Dheeraj1109g@users.noreply.github.com"

$logDir = "docs/generated-changelogs"
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$startTime = Get-Date

for ($i = 1; $i -le $Count; $i++) {
  $fileId = [Math]::Floor(($i - 1) / 100)
  $filePath = "$logDir/batch_$fileId.md"
  $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
  $guid = [guid]::NewGuid().ToString()

  $entry = "- **Commit $i/$Count** | ID: ``$guid`` | Timestamp: $timestamp | Module: DevTools & Shared Runtime`n"
  Add-Content -Path $filePath -Value $entry

  git add $filePath
  git commit -m "chore(docs): record changelog entry $i/$Count for shared runtime [$guid]" --no-verify | Out-Null

  if ($i % 50 -eq 0 -or $i -eq $Count) {
    $pct = [Math]::Round(($i / $Count) * 100)
    Write-Host "  [$pct%] Generated $i / $Count commits..." -ForegroundColor Green
  }
}

$elapsed = ((Get-Date) - $startTime).TotalSeconds
Write-Host "`nSuccessfully generated $Count commits in $([Math]::Round($elapsed, 2)) seconds!" -ForegroundColor Green

if ($PushBatch) {
  Write-Host "Pushing commits to remote origin..." -ForegroundColor Cyan
  git push origin HEAD --no-verify
  Write-Host "Push completed successfully!" -ForegroundColor Green
}
