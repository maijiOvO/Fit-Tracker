# USB live reload：手机直连本机 dev server，改代码手机上秒刷。
#
#   .\scripts\live-android.ps1              # 建隧道 + 打 live 包 + 装机 + 拉起
#   .\scripts\live-android.ps1 -TunnelOnly  # 只重建隧道（拔插数据线后用这个）
#
# 前提：另开一个终端跑着 npm run dev
#
# ⚠️ 这个包是开发专用的，离开数据线会白屏。要回正常包：npm run android

param(
    [switch]$TunnelOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$port = 3000

# ── 设备 ───────────────────────────────────────────────────
# live 模式没设备毫无意义，这里不像 deploy 那样容忍缺设备。
$devices = & $adb devices | Select-String -Pattern "\tdevice$"
if (-not $devices) {
    Write-Host "[X] 没有已连接的设备。插线，并在手机上点「允许 USB 调试」。" -ForegroundColor Red
    exit 1
}

# ── 反向隧道 ───────────────────────────────────────────────
# 手机的 localhost:3000 → 本机 localhost:3000。
# 拔线就没了，插回来必须重建 —— 所以有 -TunnelOnly。
& $adb reverse "tcp:$port" "tcp:$port" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "[X] adb reverse 失败" -ForegroundColor Red; exit 1 }
Write-Host "[OK] 隧道已建：手机 localhost:$port -> 本机 localhost:$port" -ForegroundColor Green

# ── dev server 探活 ────────────────────────────────────────
# 装完包才发现 dev server 没开，手机上就是一片白，很难往这个方向想。
$devUp = $false
try {
    $null = Invoke-WebRequest "http://localhost:$port" -UseBasicParsing -TimeoutSec 3
    $devUp = $true
} catch { }
if ($devUp) {
    Write-Host "[OK] dev server 在 $port 上活着" -ForegroundColor Green
} else {
    Write-Host "[!] $port 上没有 dev server。另开一个终端跑：npm run dev" -ForegroundColor Yellow
    Write-Host "    不影响装包，但装完打开是白屏；dev server 起来后手机上重开 App 即可。" -ForegroundColor Yellow
}

if ($TunnelOnly) {
    Write-Host "`n[i] 只重建了隧道，没重装包。" -ForegroundColor DarkGray
    exit 0
}

# ── JAVA_HOME ──────────────────────────────────────────────
# 这台机器没独立装 JDK，用 Android Studio 自带的那个（JDK 21）。
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
    $candidates = @(
        "D:\tools\Android_studio\install\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
    )
    $found = $candidates | Where-Object { Test-Path "$_\bin\java.exe" } | Select-Object -First 1
    if (-not $found) {
        Write-Host "[X] 找不到 JDK。设置 JAVA_HOME，或改本脚本的 candidates 列表。" -ForegroundColor Red
        exit 1
    }
    $env:JAVA_HOME = $found
}
Write-Host "[i] JAVA_HOME = $env:JAVA_HOME" -ForegroundColor DarkGray

# ── 同步（带 live 门控）────────────────────────────────────
# 不跑 npm run build：live 模式下 assets/public 里的东西根本不会被读，
# WebView 直接去 dev server 拿。dist/ 只需存在，好让 cap sync 有东西可拷。
if (-not (Test-Path "dist\index.html")) {
    Write-Host "[!] dist/ 是空的，先构建一次让 cap sync 有东西可拷。" -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host "[X] 构建失败" -ForegroundColor Red; exit 1 }
}

Write-Host "`n[1/3] npx cap sync android（CAP_LIVE_RELOAD=1）..." -ForegroundColor Cyan
$env:CAP_LIVE_RELOAD = '1'
try {
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { Write-Host "[X] cap sync 失败" -ForegroundColor Red; exit 1 }

    # 反向闸门：这一次【必须】带上 server.url。没带说明门控没生效，
    # 装上去还是个静态包，而你会以为它在 live —— 正是要避免的那种误判。
    $baked = Get-Content "android\app\src\main\assets\capacitor.config.json" -Raw | ConvertFrom-Json
    if (-not $baked.server -or $baked.server.url -ne "http://localhost:$port") {
        Write-Host "[X] 包里没有 server.url —— CAP_LIVE_RELOAD 门控没生效，装了也不是 live。" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] server.url = $($baked.server.url)" -ForegroundColor Green
} finally {
    # 别把变量留在会话里，否则同一个终端接着跑 npm run android 会打出 live 包
    Remove-Item Env:\CAP_LIVE_RELOAD -ErrorAction SilentlyContinue
}

# ── 打包 ───────────────────────────────────────────────────
Write-Host "`n[2/3] gradlew assembleDebug..." -ForegroundColor Cyan
Push-Location android
& ".\gradlew.bat" assembleDebug --console=plain
$gradleExit = $LASTEXITCODE
Pop-Location
if ($gradleExit -ne 0) { Write-Host "[X] gradle 构建失败" -ForegroundColor Red; exit 1 }

# ── 装机 ───────────────────────────────────────────────────
$apk = "android\app\build\outputs\apk\debug\app-debug.apk"
Write-Host "`n[3/3] 安装到设备..." -ForegroundColor Cyan
& $adb install -r $apk
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!] 覆盖安装失败，多半是签名不一致。先卸载：adb uninstall com.myron.fittracker" -ForegroundColor Yellow
    Write-Host "    本地数据会清掉，但训练记录在 NAS 上，重装后会同步回来。" -ForegroundColor Yellow
    exit 1
}
& $adb shell monkey -p com.myron.fittracker -c android.intent.category.LAUNCHER 1 | Out-Null

Write-Host "`n[OK] live 模式装好了。" -ForegroundColor Green
Write-Host "     改代码 -> 手机上自动刷新，不用再跑这个脚本。" -ForegroundColor Green
Write-Host "     拔插数据线后隧道会断，重建：npm run android:live -- -TunnelOnly" -ForegroundColor DarkGray
Write-Host "     回正常离线包：npm run android" -ForegroundColor DarkGray
