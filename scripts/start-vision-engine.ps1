# start-vision-engine.ps1 — Vision Engine 원클릭 실행기
# Ollama(D경로 자가치유) → OpenClaw 게이트웨이(예약작업) → 웹앱(Vite) 순서로 확인·기동 후 브라우저를 연다.
# 이미 떠 있는 것은 건너뛰므로 아무 때나 다시 실행해도 안전하다.
#   사용: powershell -ExecutionPolicy Bypass -File scripts\start-vision-engine.ps1 [-Mobile]
param([switch]$Mobile)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$webapp = Join-Path $root 'webapp'

function Test-Http($url, $timeoutSec = 3) {
  try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec; return ($r.StatusCode -ge 200) } catch { return $false }
}

# HTTP보다 빠르고 오탐 없는 TCP 포트 체크 (웹앱 중복 기동 방지용)
function Test-Port($ipAddr, $port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect($ipAddr, $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1500)
    $connected = $ok -and $c.Connected
    $c.Close()
    return $connected
  } catch { return $false }
}

function Wait-Http($url, $label, $maxSec = 60) {
  for ($i = 0; $i -lt $maxSec; $i += 2) {
    if (Test-Http $url) { Write-Host "   OK - $label 준비됨" -ForegroundColor Green; return $true }
    Start-Sleep -Seconds 2
  }
  Write-Host "   실패 - $label 이 ${maxSec}초 안에 응답하지 않음" -ForegroundColor Red
  return $false
}

Write-Host ""
Write-Host "  ◮ Vision Engine 시작 $(if ($Mobile) { '(모바일 모드 - Tailscale)' } else { '(PC 로컬 모드)' })" -ForegroundColor Magenta
Write-Host "  ─────────────────────────────────────────"

# ── 1) Ollama — 모델(D:\Ollama\models)이 보이는 상태인지 확인, 아니면 D경로로 재기동 ──
Write-Host "[1/4] Ollama 확인 중..."
$ollamaOk = $false
try {
  $tags = (Invoke-WebRequest 'http://localhost:11434/api/tags' -UseBasicParsing -TimeoutSec 4).Content | ConvertFrom-Json
  if ($tags.models.Count -gt 0) { $ollamaOk = $true; Write-Host "   OK - Ollama 실행 중 (모델 $($tags.models.Count)개)" -ForegroundColor Green }
  else { Write-Host "   모델 목록이 비어 있음 (C경로로 켜진 듯) - D경로로 재기동" -ForegroundColor Yellow }
} catch { Write-Host "   Ollama 미실행 - 시작합니다" -ForegroundColor Yellow }

if (-not $ollamaOk) {
  Get-Process | Where-Object { $_.Name -like '*ollama*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $env:OLLAMA_MODELS = 'D:\Ollama\models'
  Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i += 2) {
    Start-Sleep -Seconds 2
    try {
      $tags = (Invoke-WebRequest 'http://localhost:11434/api/tags' -UseBasicParsing -TimeoutSec 3).Content | ConvertFrom-Json
      if ($tags.models.Count -gt 0) { $ollamaOk = $true; break }
    } catch {}
  }
  if ($ollamaOk) { Write-Host "   OK - Ollama D경로로 기동 완료" -ForegroundColor Green }
  else { Write-Host "   경고 - Ollama 모델이 안 보임. 트레이 아이콘에서 Quit 후 다시 실행해보세요." -ForegroundColor Red }
}

# ── 2) OpenClaw 게이트웨이 — 예약작업 "OpenClaw Gateway"로 기동 ──
Write-Host "[2/4] OpenClaw 게이트웨이 확인 중..."
if (Test-Http 'http://127.0.0.1:18789') {
  Write-Host "   OK - 게이트웨이 이미 실행 중" -ForegroundColor Green
} else {
  schtasks /Run /TN "OpenClaw Gateway" | Out-Null
  [void](Wait-Http 'http://127.0.0.1:18789' '게이트웨이(18789)' 40)
}

# ── 3) 웹앱 (Vite) ──
Write-Host "[3/4] Vision Engine 웹앱 확인 중..."
$appUrl = 'http://127.0.0.1:5199'
if ($Mobile) {
  $ts = @('C:\Program Files\Tailscale\tailscale.exe', 'tailscale') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
  $ip = if ($ts) { (& $ts ip -4 2>$null | Select-Object -First 1).Trim() } else { $null }
  if ($ip) { $appUrl = "http://${ip}:5199" }
  else { Write-Host "   경고 - Tailscale IP를 못 찾음. PC 로컬 모드로 진행" -ForegroundColor Yellow; $Mobile = $false }
}

$appIp = ([uri]$appUrl).Host
if (Test-Port $appIp 5199) {
  Write-Host "   OK - 웹앱 이미 실행 중" -ForegroundColor Green
} else {
  $npmScript = if ($Mobile) { 'dev:mobile' } else { 'dev' }
  Start-Process cmd -ArgumentList '/k', "title Vision Engine 웹앱 && cd /d `"$webapp`" && npm run $npmScript" -WindowStyle Normal
  [void](Wait-Http $appUrl "웹앱($appUrl)" 90)
}

# ── 4) 브라우저 열기 ──
Write-Host "[4/4] 브라우저 열기..."
Start-Process $appUrl

Write-Host ""
Write-Host "  ─────────────────────────────────────────"
Write-Host "  ✔ Vision Engine 준비 완료" -ForegroundColor Magenta
Write-Host "    웹앱      : $appUrl"
Write-Host "    기본 WebChat: http://127.0.0.1:18789"
if ($Mobile) { Write-Host "    📱 폰에서: $appUrl  (폰에 Tailscale 앱 로그인 필요)" -ForegroundColor Cyan }
Write-Host "    종료: 'Vision Engine 웹앱' 창을 닫으면 웹앱만 꺼집니다 (게이트웨이/Ollama는 유지)"
Write-Host ""
