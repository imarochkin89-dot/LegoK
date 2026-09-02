[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [string]$Name = "",
    [string]$InstallRoot = "C:\ProgramData\Kontur"
)

$ErrorActionPreference = "Stop"
$configPath = Join-Path $InstallRoot "config\kontur.json"
$appRoot = Join-Path $InstallRoot "app"
$bundledNode = Join-Path $appRoot "distribution\windows-server\node\node.exe"
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$tool = Join-Path $appRoot "distribution\windows-server\runtime\config-tool.mjs"
$arguments = @($tool, "add-user", "--config", $configPath, "--email", $Email)
if ($Name) { $arguments += @("--name", $Name) }
$resultJson = & $nodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "Не удалось добавить пользователя." }
$result = $resultJson | ConvertFrom-Json
& (Join-Path $PSScriptRoot "Stop-Kontur.ps1") -InstallRoot $InstallRoot
& (Join-Path $PSScriptRoot "Start-Kontur.ps1") -InstallRoot $InstallRoot

Write-Host "Локальный пользователь создан." -ForegroundColor Green
Write-Host "Email: $($result.email)"
Write-Host "Пароль: $($result.password)" -ForegroundColor Yellow
Write-Host "Теперь владелец должен добавить этот же email в разделе «Команда» планировщика."
