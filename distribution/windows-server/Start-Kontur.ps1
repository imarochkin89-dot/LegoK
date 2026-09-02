[CmdletBinding()]
param([string]$InstallRoot = "C:\ProgramData\Kontur")

$ErrorActionPreference = "Stop"
$taskName = "Kontur Local Edition"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { throw "Контур не установлен: задача автозапуска не найдена." }
Start-ScheduledTask -TaskName $taskName
Write-Host "Контур запускается. Проверить состояние: .\Status-Kontur.ps1" -ForegroundColor Green
