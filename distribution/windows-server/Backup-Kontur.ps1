[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\ProgramData\Kontur",
    [string]$Destination = ""
)

$ErrorActionPreference = "Stop"
$taskName = "Kontur Local Edition"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupRoot = if ($Destination) { [IO.Path]::GetFullPath($Destination) } else { Join-Path $InstallRoot "backups" }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$archive = Join-Path $backupRoot ("kontur-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")

Write-Host "Контур будет ненадолго остановлен для целостной резервной копии." -ForegroundColor Yellow
& (Join-Path $scriptRoot "Stop-Kontur.ps1") -InstallRoot $InstallRoot
try {
    $items = @("data", "config", "tls") | Where-Object { Test-Path -LiteralPath (Join-Path $InstallRoot $_) }
    if (-not $items) { throw "Данные для резервного копирования не найдены." }
    & tar.exe -a -c -f $archive -C $InstallRoot @items
    if ($LASTEXITCODE -ne 0) { throw "Не удалось создать архив резервной копии." }
} finally {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        & (Join-Path $scriptRoot "Start-Kontur.ps1") -InstallRoot $InstallRoot
    }
}
Write-Host "Резервная копия создана: $archive" -ForegroundColor Green
Write-Warning "Архив содержит конфигурацию и ключ HTTPS. Храните его в защищённом месте."
