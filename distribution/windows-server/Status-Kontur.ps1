[CmdletBinding()]
param([string]$InstallRoot = "C:\ProgramData\Kontur")

$ErrorActionPreference = "Stop"
$taskName = "Kontur Local Edition"
$configPath = Join-Path $InstallRoot "config\kontur.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "Конфигурация не найдена: $configPath" }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$pidFile = Join-Path $InstallRoot "run\kontur.pid.json"
$runtime = $null
if (Test-Path -LiteralPath $pidFile) {
    try {
        $pidInfo = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $runtime = Get-Process -Id ([int]$pidInfo.pid) -ErrorAction SilentlyContinue
    } catch { $runtime = $null }
}

Write-Host "Контур Community Edition" -ForegroundColor Cyan
Write-Host ("Задача автозапуска: " + $(if ($task) { $task.State } else { "не найдена" }))
Write-Host ("Процесс: " + $(if ($runtime) { "работает, PID $($runtime.Id)" } else { "не запущен" }))
Write-Host "Планировщик: https://$($config.network.plannerHost)"
Write-Host "Портал: https://$($config.network.portalHost)"
Write-Host "Журнал: $InstallRoot\logs\kontur-runtime.log"
