# 一键：构建 → 同步 → 打 APK → 装到手机
#
#   .\scripts\deploy-android.ps1            # prod 数据环境（连 NAS 真实数据）
#   .\scripts\deploy-android.ps1 -Dev       # dev 数据环境（隔离，随便造数据）
#   .\scripts\deploy-android.ps1 -SkipBuild # 只重装现有 APK，不重新编译
#
# 不用连 USB 也能出 APK —— 只是最后那步装不上，脚本会把文件路径告诉你。

param(
    [switch]$Dev,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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
        Write-Host "[X] 找不到 JDK。请设置 JAVA_HOME，或改一下本脚本里的 candidates 列表。" -ForegroundColor Red
        exit 1
    }
    $env:JAVA_HOME = $found
}
Write-Host "[i] JAVA_HOME = $env:JAVA_HOME" -ForegroundColor DarkGray

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$apk = "android\app\build\outputs\apk\debug\app-debug.apk"

if (-not $SkipBuild) {
    # ── 1. 构建 web 产物 ──────────────────────────────────
    $mode = if ($Dev) { 'dev' } else { 'prod' }
    Write-Host "`n[1/4] 构建 web 产物（$mode 数据环境）..." -ForegroundColor Cyan
    if ($Dev) { npm run build } else { npm run build:release }
    if ($LASTEXITCODE -ne 0) { Write-Host "[X] web 构建失败" -ForegroundColor Red; exit 1 }

    # 环境戳闸门：dev 包装到手机上会去读写 state-dev，看不到自己的记录
    $stamp = (Get-Content "dist\fitlog-build-env.json" -Raw | ConvertFrom-Json).env
    if ($stamp -ne $mode) {
        Write-Host "[X] 环境戳是 '$stamp'，期望 '$mode' —— 构建链路有问题，停。" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] 环境戳: $stamp" -ForegroundColor Green

    # ── 2. 同步进原生工程 ─────────────────────────────────
    Write-Host "`n[2/4] npx cap sync android..." -ForegroundColor Cyan
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { Write-Host "[X] cap sync 失败" -ForegroundColor Red; exit 1 }

    # ── 3. 打 APK ─────────────────────────────────────────
    Write-Host "`n[3/4] gradlew assembleDebug..." -ForegroundColor Cyan
    Push-Location android
    & ".\gradlew.bat" assembleDebug --console=plain
    $gradleExit = $LASTEXITCODE
    Pop-Location
    if ($gradleExit -ne 0) { Write-Host "[X] gradle 构建失败" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "[i] 跳过构建，直接装现有 APK" -ForegroundColor DarkGray
}

if (-not (Test-Path $apk)) {
    Write-Host "[X] 没找到 $apk" -ForegroundColor Red
    exit 1
}
$sizeMB = [math]::Round((Get-Item $apk).Length / 1MB, 2)
Write-Host "[OK] APK: $apk ($sizeMB MB)" -ForegroundColor Green

# ── 4. 装到手机 ────────────────────────────────────────────
Write-Host "`n[4/4] 安装到设备..." -ForegroundColor Cyan
$devices = & $adb devices | Select-String -Pattern "\tdevice$"
if (-not $devices) {
    Write-Host "[!] 没有已连接的设备，跳过安装。" -ForegroundColor Yellow
    Write-Host "    手机上要先打开「开发者选项 → USB 调试」，插线后在手机上点「允许」。" -ForegroundColor Yellow
    Write-Host "    或者直接把这个文件传到手机上点开装：" -ForegroundColor Yellow
    Write-Host "    $root\$apk" -ForegroundColor Cyan
    exit 0
}

# -r 覆盖安装、保留数据。签名不一致时会失败，那时才需要先卸载。
& $adb install -r $apk
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[!] 覆盖安装失败。最常见原因是签名不一致（之前装的是别的签名打的包）。" -ForegroundColor Yellow
    Write-Host "    卸载后重装：adb uninstall com.myron.fittracker" -ForegroundColor Yellow
    Write-Host "    本地数据会清掉，但训练记录在 NAS 上，重装后会同步回来。" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n[OK] 装好了。" -ForegroundColor Green
& $adb shell monkey -p com.myron.fittracker -c android.intent.category.LAUNCHER 1 | Out-Null
Write-Host "[i] 已在手机上拉起 App" -ForegroundColor DarkGray
