[CmdletBinding()]
param(
    [string]$InstallRoot = "C:\ProgramData\Kontur",
    [string]$PlannerHost = "planner.kontur.local",
    [string]$PortalHost = "portal.kontur.local",
    [string[]]$AllowedNetworks = @("LocalSubnet"),
    [string]$AdminEmail = "admin@kontur.local",
    [string]$AdminName = "Администратор",
    [switch]$ForceRebuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$TaskName = "Kontur Local Edition"
$FirewallRuleName = "Kontur Local Edition Web"

function Write-Step([string]$Text) {
    Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Запустите PowerShell от имени администратора."
    }
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw "Поддерживается только 64-битная Windows Server."
    }
}

function Assert-SafeInstallRoot([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $driveRoot = [IO.Path]::GetPathRoot($full).TrimEnd('\')
    if ($full.Length -lt 10 -or $full -eq $driveRoot -or $full -eq $env:SystemRoot.TrimEnd('\')) {
        throw "Небезопасный каталог установки: $full"
    }
    return $full
}

function Get-NodeVersion([string]$NodePath) {
    try {
        $value = (& $NodePath -p "process.versions.node").Trim()
        if ($LASTEXITCODE -ne 0) { return $null }
        return [version]$value
    } catch { return $null }
}

function Find-SystemNode {
    $candidates = New-Object System.Collections.Generic.List[string]
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates.Add($command.Source) }
    if ($env:ProgramFiles) { $candidates.Add((Join-Path $env:ProgramFiles "nodejs\node.exe")) }
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    if ($programFilesX86) { $candidates.Add((Join-Path $programFilesX86 "nodejs\node.exe")) }
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath $candidate) -and (Get-NodeVersion $candidate) -ge [version]"22.13.0") {
            return $candidate
        }
    }
    return $null
}

function Install-OfficialNode {
    Write-Step "Установка официального Node.js 22"
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("kontur-node-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    try {
        $baseUrl = "https://nodejs.org/dist/latest-v22.x"
        $sumsPath = Join-Path $tempRoot "SHASUMS256.txt"
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $sumsPath
        $sums = Get-Content -LiteralPath $sumsPath -Raw
        $match = [regex]::Match($sums, "(?m)^([a-f0-9]{64})\s+(node-v22\.[0-9]+\.[0-9]+-x64\.msi)$")
        if (-not $match.Success) { throw "Не удалось определить актуальный пакет Node.js 22." }
        $expectedHash = $match.Groups[1].Value.ToUpperInvariant()
        $fileName = $match.Groups[2].Value
        $msiPath = Join-Path $tempRoot $fileName
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$fileName" -OutFile $msiPath
        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $msiPath).Hash
        if ($actualHash -ne $expectedHash) { throw "Контрольная сумма Node.js не совпала." }
        $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", "`"$msiPath`"", "/qn", "/norestart") -Wait -PassThru
        if ($process.ExitCode -notin @(0, 1641, 3010)) { throw "Установщик Node.js завершился с кодом $($process.ExitCode)." }
    } finally {
        if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    }
    $nodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (-not (Test-Path -LiteralPath $nodePath)) { throw "Node.js установлен, но node.exe не найден." }
    return $nodePath
}

function Invoke-External([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Команда $FilePath завершилась с кодом $LASTEXITCODE." }
    } finally { Pop-Location }
}

function Stop-ExistingRuntime([string]$PidFile) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    if (Test-Path -LiteralPath $PidFile) {
        try {
            $pidInfo = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
            $runtimePid = [int]$pidInfo.pid
            if (Get-Process -Id $runtimePid -ErrorAction SilentlyContinue) {
                & taskkill.exe /PID $runtimePid /T /F | Out-Null
            }
        } catch { Write-Warning "Не удалось корректно остановить прежний процесс: $($_.Exception.Message)" }
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }
}

function Add-LocalHosts([string[]]$Names) {
    $hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
    $begin = "# BEGIN KONTUR LOCAL EDITION"
    $end = "# END KONTUR LOCAL EDITION"
    $content = Get-Content -LiteralPath $hostsPath -Raw
    $pattern = "(?ms)^" + [regex]::Escape($begin) + ".*?^" + [regex]::Escape($end) + "\s*"
    $clean = [regex]::Replace($content, $pattern, "").TrimEnd()
    $block = @($begin) + ($Names | ForEach-Object { "127.0.0.1`t$_" }) + @($end)
    Set-Content -LiteralPath $hostsPath -Value ($clean + "`r`n" + ($block -join "`r`n") + "`r`n") -Encoding ASCII
}

function New-KonturCertificate([pscustomobject]$Config, [string]$TlsRoot) {
    Write-Step "Создание локального HTTPS-сертификата"
    New-Item -ItemType Directory -Path $TlsRoot -Force | Out-Null
    $rootCertificate = $null
    $leafCertificate = $null
    try {
        $rootCertificate = New-SelfSignedCertificate `
            -Type Custom `
            -Subject "CN=Kontur Local Root CA" `
            -KeyAlgorithm RSA `
            -KeyLength 4096 `
            -HashAlgorithm SHA256 `
            -KeyExportPolicy Exportable `
            -KeyUsage CertSign, CRLSign, DigitalSignature `
            -NotAfter (Get-Date).AddYears(10) `
            -CertStoreLocation "Cert:\LocalMachine\My" `
            -TextExtension @("2.5.29.19={critical}{text}ca=TRUE&pathlength=1")
        $rootCer = Join-Path $TlsRoot "kontur-root-ca.cer"
        Export-Certificate -Cert $rootCertificate -FilePath $rootCer -Type CERT | Out-Null
        $leafCertificate = New-SelfSignedCertificate `
            -Type Custom `
            -Subject ("CN=" + $Config.network.plannerHost) `
            -DnsName @($Config.network.plannerHost, $Config.network.portalHost) `
            -Signer $rootCertificate `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -KeyExportPolicy Exportable `
            -NotAfter (Get-Date).AddYears(5) `
            -CertStoreLocation "Cert:\LocalMachine\My"
        $securePassword = ConvertTo-SecureString -String $Config.tls.pfxPassword -AsPlainText -Force
        Export-PfxCertificate -Cert $leafCertificate -FilePath $Config.paths.tlsPfx -Password $securePassword -ChainOption EndEntityCertOnly | Out-Null
        @{ root = $rootCertificate.Thumbprint; leaf = $leafCertificate.Thumbprint } |
            ConvertTo-Json |
            Set-Content -LiteralPath (Join-Path $TlsRoot "certificate-thumbprints.json") -Encoding UTF8
    } finally {
        if ($leafCertificate) { Remove-Item -LiteralPath ("Cert:\LocalMachine\My\" + $leafCertificate.Thumbprint) -Force -ErrorAction SilentlyContinue }
        if ($rootCertificate) { Remove-Item -LiteralPath ("Cert:\LocalMachine\My\" + $rootCertificate.Thumbprint) -Force -ErrorAction SilentlyContinue }
    }
}

function Test-TcpPort([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(800)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

Assert-Administrator
$InstallRoot = Assert-SafeInstallRoot $InstallRoot
$SourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$AppRoot = Join-Path $InstallRoot "app"
$ConfigRoot = Join-Path $InstallRoot "config"
$ConfigPath = Join-Path $ConfigRoot "kontur.json"
$PidFile = Join-Path $InstallRoot "run\kontur.pid.json"
$TlsRoot = Join-Path $InstallRoot "tls"

if ($SourceRoot.TrimEnd('\') -eq $AppRoot.TrimEnd('\') -or $SourceRoot.StartsWith($AppRoot + "\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Запустите установщик из распакованного дистрибутива, а не из рабочего каталога $AppRoot."
}

Write-Host "`nКонтур Community Edition — установка на Windows Server" -ForegroundColor Green
Write-Host "Каталог: $InstallRoot"
Write-Host "Планировщик: https://$PlannerHost"
Write-Host "Портал: https://$PortalHost"

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Stop-ExistingRuntime $PidFile

Write-Step "Копирование файлов приложения"
New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null
$robocopyArguments = @(
    $SourceRoot, $AppRoot, "/MIR", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
    "/XD", ".git", "node_modules", ".wrangler", ".next", ".vinext", ".sites-runtime",
    "/XF", ".env", ".env.local"
)
& robocopy.exe @robocopyArguments | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Не удалось скопировать файлы (robocopy: $LASTEXITCODE)." }

$BundledNode = Join-Path $AppRoot "distribution\windows-server\node\node.exe"
$BundledWrangler = Join-Path $AppRoot "distribution\windows-server\runtime-package\node_modules\wrangler\bin\wrangler.js"
$HasPrebuiltApps = (Test-Path -LiteralPath (Join-Path $AppRoot "apps\planner\dist\server\index.js")) -and
    (Test-Path -LiteralPath (Join-Path $AppRoot "apps\portal\dist\server\index.js"))
$IsOfflineBundle = (Test-Path -LiteralPath $BundledNode) -and (Test-Path -LiteralPath $BundledWrangler) -and $HasPrebuiltApps

if ($IsOfflineBundle) {
    Write-Step "Найден автономный пакет — интернет для установки не требуется"
    $NodePath = $BundledNode
} else {
    $NodePath = Find-SystemNode
    if (-not $NodePath) { $NodePath = Install-OfficialNode }
    Write-Step "Установка зависимостей и сборка приложений"
    $npmPath = Join-Path (Split-Path -Parent $NodePath) "npm.cmd"
    if (-not (Test-Path -LiteralPath $npmPath)) {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npmCommand) { throw "npm.cmd не найден." }
        $npmPath = $npmCommand.Source
    }
    foreach ($appName in @("planner", "portal")) {
        $appDirectory = Join-Path $AppRoot "apps\$appName"
        Invoke-External $npmPath @("ci", "--no-audit", "--no-fund") $appDirectory
    }
    $plannerDirectory = Join-Path $AppRoot "apps\planner"
    $portalDirectory = Join-Path $AppRoot "apps\portal"
    if ($ForceRebuild) {
        foreach ($distPath in @((Join-Path $plannerDirectory "dist"), (Join-Path $portalDirectory "dist"))) {
            if (Test-Path -LiteralPath $distPath) { Remove-Item -LiteralPath $distPath -Recurse -Force }
        }
    }
    Invoke-External (Join-Path $plannerDirectory "node_modules\.bin\vinext.cmd") @("build") $plannerDirectory
    Invoke-External $NodePath @("scripts\finalize-build.mjs") $plannerDirectory
    Invoke-External (Join-Path $portalDirectory "node_modules\.bin\vinext.cmd") @("build") $portalDirectory
}

Write-Step "Подготовка локальной конфигурации"
New-Item -ItemType Directory -Path $ConfigRoot -Force | Out-Null
$firstInstall = -not (Test-Path -LiteralPath $ConfigPath)
$credentials = $null
if ($firstInstall) {
    $env:KONTUR_INSTALL_ROOT = $InstallRoot
    $env:KONTUR_PLANNER_HOST = $PlannerHost
    $env:KONTUR_PORTAL_HOST = $PortalHost
    $env:KONTUR_ADMIN_EMAIL = $AdminEmail
    $env:KONTUR_ADMIN_NAME = $AdminName
    try {
        $configTool = Join-Path $AppRoot "distribution\windows-server\runtime\config-tool.mjs"
        $credentialJson = & $NodePath $configTool "create" "--config" $ConfigPath
        if ($LASTEXITCODE -ne 0) { throw "Не удалось создать конфигурацию." }
        $credentials = $credentialJson | ConvertFrom-Json
    } finally {
        Remove-Item Env:\KONTUR_INSTALL_ROOT, Env:\KONTUR_PLANNER_HOST, Env:\KONTUR_PORTAL_HOST, Env:\KONTUR_ADMIN_EMAIL, Env:\KONTUR_ADMIN_NAME -ErrorAction SilentlyContinue
    }
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

if (-not (Test-Path -LiteralPath $config.paths.tlsPfx)) { New-KonturCertificate $config $TlsRoot }
$rootCerPath = Join-Path $TlsRoot "kontur-root-ca.cer"
if (Test-Path -LiteralPath $rootCerPath) {
    Import-Certificate -FilePath $rootCerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null
}
Add-LocalHosts @($config.network.plannerHost, $config.network.portalHost)

Write-Step "Настройка брандмауэра и автозапуска"
Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $FirewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort @([int]$config.network.httpPort, [int]$config.network.httpsPort) `
    -RemoteAddress $AllowedNetworks `
    -Profile Domain,Private | Out-Null

$serverScript = Join-Path $AppRoot "distribution\windows-server\runtime\server.mjs"
$taskAction = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$serverScript`" --config `"$ConfigPath`"" -WorkingDirectory $AppRoot
$taskTrigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null

& icacls.exe $InstallRoot /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Warning "Не удалось полностью применить ACL к каталогу установки." }

if ($firstInstall -and $credentials) {
    $loginFile = Join-Path $InstallRoot "FIRST-LOGIN.txt"
    $loginText = @"
Контур Community Edition

Планировщик: https://$($config.network.plannerHost)
Публичный портал: https://$($config.network.portalHost)

Email: $($credentials.email)
Пароль: $($credentials.password)

Сохраните пароль в менеджере паролей и удалите этот файл.
Корневой сертификат для клиентских компьютеров: $TlsRoot\kontur-root-ca.cer
"@
    Set-Content -LiteralPath $loginFile -Value $loginText -Encoding UTF8
    & icacls.exe $loginFile /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
}

Start-ScheduledTask -TaskName $TaskName
$deadline = (Get-Date).AddMinutes(2)
do {
    Start-Sleep -Milliseconds 750
    $ready = Test-TcpPort ([int]$config.network.httpsPort)
} until ($ready -or (Get-Date) -ge $deadline)
if (-not $ready) {
    $logPath = Join-Path $InstallRoot "logs\kontur-runtime.log"
    throw "Сервис не запустился. Проверьте журнал: $logPath"
}

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } |
    Select-Object -ExpandProperty IPAddress -Unique
$resultPath = Join-Path $InstallRoot "INSTALLATION-RESULT.txt"
$resultText = @"
Контур установлен и запущен.

Планировщик: https://$($config.network.plannerHost)
Публичный портал: https://$($config.network.portalHost)
IP-адреса сервера: $($addresses -join ", ")

На DNS-сервере создайте две A-записи на IP этого сервера:
$($config.network.plannerHost)
$($config.network.portalHost)

На клиентские компьютеры установите сертификат:
$TlsRoot\kontur-root-ca.cer
"@
Set-Content -LiteralPath $resultPath -Value $resultText -Encoding UTF8

Write-Host "`nГотово! Контур установлен и запущен." -ForegroundColor Green
Write-Host "Планировщик: https://$($config.network.plannerHost)"
Write-Host "Публичный портал: https://$($config.network.portalHost)"
if ($firstInstall) { Write-Host "Первый логин: $InstallRoot\FIRST-LOGIN.txt" -ForegroundColor Yellow }
Write-Host "Инструкция: $AppRoot\distribution\windows-server\README-RU.md"
