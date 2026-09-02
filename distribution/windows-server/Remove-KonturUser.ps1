[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$InstallRoot = "C:\ProgramData\Kontur"
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $InstallRoot "config\kontur.json"
$appRoot = Join-Path $InstallRoot "app"
$bundledNode = Join-Path $appRoot "distribution\windows-server\node\node.exe"
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$tool = Join-Path $appRoot "distribution\windows-server\runtime\config-tool.mjs"
& $nodePath $tool "remove-user" "--config" $configPath "--email" $Email
if ($LASTEXITCODE -ne 0) { throw "Не удалось удалить пользователя." }
& (Join-Path $PSScriptRoot "Stop-Kontur.ps1") -InstallRoot $InstallRoot
& (Join-Path $PSScriptRoot "Start-Kontur.ps1") -InstallRoot $InstallRoot
Write-Host "Локальный доступ пользователя $Email отозван." -ForegroundColor Green
Write-Host "При необходимости удалите его также в разделе «Команда» планировщика."
