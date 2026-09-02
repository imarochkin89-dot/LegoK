[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\ProgramData\Kontur",
    [switch]$RemoveFiles
)

$ErrorActionPreference = "Stop"
$taskName = "Kontur Local Edition"
$firewallRuleName = "Kontur Local Edition Web"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    & (Join-Path $scriptRoot "Stop-Kontur.ps1") -InstallRoot $InstallRoot
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$thumbprintsPath = Join-Path $InstallRoot "tls\certificate-thumbprints.json"
if (Test-Path -LiteralPath $thumbprintsPath) {
    try {
        $thumbprints = Get-Content -LiteralPath $thumbprintsPath -Raw | ConvertFrom-Json
        if ($thumbprints.root -and (Test-Path -LiteralPath ("Cert:\LocalMachine\Root\" + $thumbprints.root))) {
            Remove-Item -LiteralPath ("Cert:\LocalMachine\Root\" + $thumbprints.root) -Force
        }
    } catch { Write-Warning "Не удалось удалить локальный корневой сертификат: $($_.Exception.Message)" }
}

$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$begin = "# BEGIN KONTUR LOCAL EDITION"
$end = "# END KONTUR LOCAL EDITION"
$content = Get-Content -LiteralPath $hostsPath -Raw
$pattern = "(?ms)^" + [regex]::Escape($begin) + ".*?^" + [regex]::Escape($end) + "\s*"
Set-Content -LiteralPath $hostsPath -Value ([regex]::Replace($content, $pattern, "")) -Encoding ASCII

if ($RemoveFiles) {
    $full = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    $driveRoot = [IO.Path]::GetPathRoot($full).TrimEnd('\')
    if ($full.Length -lt 10 -or $full -eq $driveRoot -or $full -eq $env:SystemRoot.TrimEnd('\')) {
        throw "Отказ от удаления небезопасного пути: $full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
    Write-Host "Контур и локальные данные удалены без возможности восстановления." -ForegroundColor Yellow
} else {
    Write-Host "Контур отключён. Файлы и данные сохранены в $InstallRoot." -ForegroundColor Green
    Write-Host "Для полного удаления повторите команду с параметром -RemoveFiles."
}
