[CmdletBinding()]
param([string]$InstallRoot = "C:\ProgramData\Kontur")

$ErrorActionPreference = "Stop"
$taskName = "Kontur Local Edition"
$pidFile = Join-Path $InstallRoot "run\kontur.pid.json"
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $pidFile) {
    try {
        $pidInfo = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $runtimePid = [int]$pidInfo.pid
        if (Get-Process -Id $runtimePid -ErrorAction SilentlyContinue) {
            & taskkill.exe /PID $runtimePid /T /F | Out-Null
        }
    } finally {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "Контур остановлен." -ForegroundColor Yellow
