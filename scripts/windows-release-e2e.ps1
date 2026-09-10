[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [int]$Port = 0,
  [string]$ReportPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

if ($env:OS -ne "Windows_NT") {
  throw "Windows 설치 E2E는 Windows에서만 실행할 수 있습니다."
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([IO.Path]::GetExtension($resolvedInstaller) -ne ".exe") {
  throw "NSIS .exe 설치 파일이 필요합니다."
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$runRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("vision-engine-release-e2e-" + [guid]::NewGuid().ToString("N"))))
if (-not $runRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or $runRoot -eq $tempBase) {
  throw "E2E 임시 경로 안전 검사에 실패했습니다: $runRoot"
}

$installDir = Join-Path $runRoot "app"
$userDataDir = Join-Path $runRoot "user-data"
$appExe = Join-Path $installDir "Vision Engine.exe"
$testDataRoot = Join-Path $userDataDir "vision-engine-data"
$testProjectDir = Join-Path $testDataRoot "workspace\projects\e2e-deck"
$Port = if ($Port -ge 1024 -and $Port -le 65535) { $Port } else { Get-Random -Minimum 52000 -Maximum 62000 }
$baseUrl = "http://127.0.0.1:$Port"
$appProcess = $null
$uninstaller = $null
$uninstallVerified = $false
$startedAt = Get-Date
$report = $null
$resolvedReport = ""

function Wait-Readiness([datetime]$Deadline) {
  $lastError = ""
  while ((Get-Date) -lt $Deadline) {
    try {
      return Invoke-RestMethod -Uri "$baseUrl/api/readiness" -TimeoutSec 10
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 2
    }
  }
  throw "준비 API 시간 초과: $lastError"
}

function Stop-TestProcesses {
  if (-not (Test-Path -LiteralPath $appExe)) { return }
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $appExe } |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

try {
  New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
  Write-Host "[E2E] 임시 설치 시작: $installDir"
  $installer = Start-Process -FilePath $resolvedInstaller -ArgumentList @("/S", "/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw "설치 프로그램 종료 코드: $($installer.ExitCode)" }
  if (-not (Test-Path -LiteralPath $appExe)) { throw "설치된 실행 파일을 찾지 못했습니다: $appExe" }
  Stop-TestProcesses

  $uninstaller = Get-ChildItem -LiteralPath $installDir -File -Filter "*ninstall*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $uninstaller) { throw "무인 제거 검증용 실행 파일을 찾지 못했습니다." }

  $env:VE_RUNTIME_PORT = [string]$Port
  $env:VE_USER_DATA_DIR = $userDataDir
  $env:VE_SKIP_OPENCLAW_SETUP = "1"
  $env:VE_SKIP_OPENCLAW_GATEWAY = "1"
  $env:VE_SKIP_DATA_MIGRATION = "1"
  $env:VE_DISABLE_UPDATES = "1"
  $env:ELECTRON_ENABLE_LOGGING = "1"

  New-Item -ItemType Directory -Path $testProjectDir -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path $testProjectDir "project.json"),
    '{"id":"e2e-deck","name":"릴리스 E2E"}',
    [Text.UTF8Encoding]::new($false)
  )

  Write-Host "[E2E] 격리 앱 실행 및 준비 상태 확인: $baseUrl"
  $appProcess = Start-Process -FilePath $appExe -ArgumentList "--disable-gpu" -PassThru
  $readiness = Wait-Readiness ((Get-Date).AddSeconds(120))
  if ($readiness.ok -ne $true -or $readiness.desktop -ne $true) { throw "데스크톱 준비 상태가 올바르지 않습니다." }
  if ($readiness.codex.installed -ne $true) { throw "설치본에 Codex 네이티브 실행 파일이 없습니다." }

  Write-Host "[E2E] 설치본 PDF·PPTX 발표자료 렌더링 검증"
  $deckPayload = @{
    projectId = "e2e-deck"
    formats = @("html", "pdf", "pptx")
    markdown = "---`nmarp: true`npaginate: true`n---`n`n# Vision Engine`n`n설치본 발표자료 렌더링 검증`n`n---`n`n## 결과`n`n- HTML`n- PDF`n- PPTX"
  } | ConvertTo-Json -Depth 5
  $deck = Invoke-RestMethod -Uri "$baseUrl/api/deck/render" -Method Post -ContentType "application/json" -Body $deckPayload -TimeoutSec 240
  if ($deck.ok -ne $true -or @($deck.errors).Count -ne 0) {
    throw "설치본 발표자료 렌더링 실패: $(@($deck.errors) -join ' / ')"
  }
  $deckDir = Join-Path $testProjectDir "deck"
  foreach ($expected in @(
    @{ Name = "deck.html"; Magic = "<!doc" },
    @{ Name = "deck.pdf"; Magic = "%PDF-" },
    @{ Name = "deck.pptx"; Magic = "PK" }
  )) {
    $deckFile = Join-Path $deckDir $expected.Name
    if (-not (Test-Path -LiteralPath $deckFile) -or (Get-Item -LiteralPath $deckFile).Length -le 1KB) {
      throw "설치본 발표자료 파일이 없거나 너무 작습니다: $($expected.Name)"
    }
    $stream = [IO.File]::OpenRead($deckFile)
    try {
      $buffer = [byte[]]::new($expected.Magic.Length)
      [void]$stream.Read($buffer, 0, $buffer.Length)
      $actualMagic = [Text.Encoding]::ASCII.GetString($buffer)
    } finally {
      $stream.Dispose()
    }
    if ($actualMagic -ne $expected.Magic) { throw "설치본 발표자료 시그니처 오류: $($expected.Name)" }
  }

  Write-Host "[E2E] 전체 프로젝트 백업·비파괴 복원 검증"
  $backupStatus = Invoke-RestMethod -Uri "$baseUrl/api/backup/status" -TimeoutSec 30
  if ($backupStatus.ok -ne $true -or $backupStatus.projects -ne 1 -or $backupStatus.files -lt 4) {
    throw "백업 상태가 올바르지 않습니다."
  }
  $backupFile = Join-Path $runRoot "release-e2e.vebackup"
  Invoke-WebRequest -Uri "$baseUrl/api/backup/export" -OutFile $backupFile -UseBasicParsing -TimeoutSec 120
  if (-not (Test-Path -LiteralPath $backupFile) -or (Get-Item -LiteralPath $backupFile).Length -le 100) {
    throw "설치본에서 백업 파일을 만들지 못했습니다."
  }
  $backupClient = [Net.Http.HttpClient]::new()
  try {
    $backupContent = [Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($backupFile))
    $backupContent.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("application/vnd.vision-engine.backup")
    $backupResponse = $backupClient.PostAsync("$baseUrl/api/backup/import", $backupContent).GetAwaiter().GetResult()
    $backupBody = $backupResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    if (-not $backupResponse.IsSuccessStatusCode -or $backupBody.ok -ne $true -or @($backupBody.imported).Count -ne 1) {
      throw "설치본 백업 복원 실패: $($backupBody.error)"
    }
    $restoredId = [string]$backupBody.imported[0].id
    if ($restoredId -eq "e2e-deck" -or -not (Test-Path -LiteralPath (Join-Path $testDataRoot "workspace\projects\$restoredId\project.json"))) {
      throw "기존 프로젝트를 덮어쓰지 않는 복원본이 만들어지지 않았습니다."
    }
  } finally {
    $backupClient.Dispose()
  }

  $head = Invoke-WebRequest -Uri "$baseUrl/" -Method Head -UseBasicParsing -TimeoutSec 15
  foreach ($header in @("Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy")) {
    if (-not $head.Headers[$header]) { throw "보안 응답 헤더가 없습니다: $header" }
  }

  $client = [Net.Http.HttpClient]::new()
  try {
    $hostAttack = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, "$baseUrl/api/readiness")
    $hostAttack.Headers.Host = "attacker.example"
    $hostResponse = $client.SendAsync($hostAttack).GetAwaiter().GetResult()
    if ([int]$hostResponse.StatusCode -ne 403) { throw "악성 Host 헤더가 차단되지 않았습니다: $([int]$hostResponse.StatusCode)" }

    $originAttack = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$baseUrl/api/readiness")
    $originAttack.Headers.Host = "127.0.0.1:$Port"
    $originAttack.Headers.Add("Origin", "https://attacker.example")
    $originAttack.Content = [Net.Http.StringContent]::new("{}", [Text.Encoding]::UTF8, "application/json")
    $originResponse = $client.SendAsync($originAttack).GetAwaiter().GetResult()
    if ([int]$originResponse.StatusCode -ne 403) { throw "외부 Origin 쓰기 요청이 차단되지 않았습니다: $([int]$originResponse.StatusCode)" }
  } finally {
    $client.Dispose()
  }

  Write-Host "[E2E] 내장 Studio 런타임 비정상 종료·자동 복구 검증"
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
  $runtimeProcessId = [int]$listener.OwningProcess
  if ($runtimeProcessId -le 0 -or $runtimeProcessId -eq $appProcess.Id) {
    throw "내장 Studio 런타임 프로세스를 식별하지 못했습니다."
  }
  Stop-Process -Id $runtimeProcessId -Force -ErrorAction Stop
  $downObserved = $false
  $downDeadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $downDeadline) {
    try {
      Invoke-RestMethod -Uri "$baseUrl/api/readiness" -TimeoutSec 1 | Out-Null
      Start-Sleep -Milliseconds 300
    } catch {
      $downObserved = $true
      break
    }
  }
  if (-not $downObserved) { throw "Studio 런타임 종료 상태를 관측하지 못했습니다." }
  $readinessAfterRecovery = Wait-Readiness ((Get-Date).AddSeconds(120))
  if ($readinessAfterRecovery.ok -ne $true -or $appProcess.HasExited) {
    throw "Studio 런타임 자동 복구에 실패했습니다."
  }

  Write-Host "[E2E] 단일 인스턴스 검증"
  $second = Start-Process -FilePath $appExe -ArgumentList "--disable-gpu" -PassThru
  if (-not $second.WaitForExit(15000)) {
    Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue
    throw "두 번째 실행 프로세스가 15초 안에 종료되지 않았습니다."
  }
  if ($appProcess.HasExited) { throw "두 번째 실행 뒤 기존 앱이 종료되었습니다." }
  $readinessAfterSecondLaunch = Wait-Readiness ((Get-Date).AddSeconds(30))

  $report = [ordered]@{
    ok = $true
    installer = $resolvedInstaller
    installedExecutable = $appExe
    runtimePort = $Port
    desktop = [bool]$readinessAfterSecondLaunch.desktop
    codexInstalled = [bool]$readinessAfterSecondLaunch.codex.installed
    codexAuthenticated = [bool]$readinessAfterSecondLaunch.codex.authenticated
    securityHeaders = $true
    hostileHostBlocked = $true
    hostileOriginBlocked = $true
    singleInstance = $true
    deckFormats = @("html", "pdf", "pptx")
    backupRoundTrip = $true
    runtimeAutoRecovery = $true
  }

  if (-not $ReportPath) {
    $ReportPath = Join-Path (Split-Path -Parent $resolvedInstaller) "windows-e2e-report.json"
  }
  $resolvedReport = [IO.Path]::GetFullPath($ReportPath)
} finally {
  Stop-TestProcesses
  Start-Sleep -Seconds 2
  if ($uninstaller -and (Test-Path -LiteralPath $uninstaller.FullName)) {
    Write-Host "[E2E] 무인 제거 검증"
    $remove = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
    if ($remove.ExitCode -ne 0) { throw "제거 프로그램 종료 코드: $($remove.ExitCode)" }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Test-Path -LiteralPath $appExe) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
    $uninstallVerified = -not (Test-Path -LiteralPath $appExe)
    if (-not $uninstallVerified) { throw "무인 제거 후 실행 파일이 남아 있습니다: $appExe" }
  }
  Stop-TestProcesses
  if (Test-Path -LiteralPath $runRoot) {
    $full = [IO.Path]::GetFullPath($runRoot)
    if ($full.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and $full -ne $tempBase) {
      Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

if (-not $uninstallVerified) { throw "제거 검증이 완료되지 않았습니다." }
$report["uninstallVerified"] = $true
$report["elapsedSeconds"] = [math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedReport) -Force | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resolvedReport -Encoding utf8
$report | ConvertTo-Json -Depth 5
Write-Host "[E2E] 설치·실행·백업·보안·단일 인스턴스·제거 검증 통과"
