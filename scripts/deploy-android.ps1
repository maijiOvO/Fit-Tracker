# 一键：构建 → 同步 → 打 APK → 装到手机
#
#   .\scripts\deploy-android.ps1            # prod 数据环境（连 NAS 真实数据）
#   .\scripts\deploy-android.ps1 -Dev       # dev 数据环境（隔离，随便造数据）
#   .\scripts\deploy-android.ps1 -SkipBuild # 只重装现有 APK，不重新编译
#
# 不用连 USB 也能出 APK —— 只是最后那步装不上，脚本会把文件路径告诉你。
#
# ⚠️ 正在用 live 模式开发时，别为了「看新图标」跑这个脚本 —— 它打的是静态包，
#    一装就把 live 顶掉了。live 包也是从同一份 res/ 编出来的，
#    图标、启动图、原生配置这些照样在里面，所以那种情况直接跑：
#      npm run android:live
#    本脚本只在你要一个【离开数据线也能用】的包时才需要。

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

    # live reload 闸门：CAP_LIVE_RELOAD 要是还留在会话里，这里会打出一个
    # 带 server.url 的包 —— 那种包离开数据线就是纯白屏，不报错、不回落本地资源，
    # 从界面上根本看不出原因。跟环境戳一样，宁可现在停。
    $baked = Get-Content "android\app\src\main\assets\capacitor.config.json" -Raw | ConvertFrom-Json
    if ($baked.PSObject.Properties.Name -contains 'server') {
        Write-Host "[X] 包里带着 live reload 的 server.url，这个包离线会白屏 —— 停。" -ForegroundColor Red
        Write-Host "    清掉变量再跑：`$env:CAP_LIVE_RELOAD = `$null" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "[OK] 无 live reload 残留" -ForegroundColor Green

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

# 这个包是静态的：代码固化在 APK 里，不再走 dev server。
# 之前如果在 live 模式下开发（比如为了换图标临时跑一次本脚本），
# 这一装就把 live 模式顶掉了 —— 而隧道还在、dev server 也还活着，
# 于是「一切看起来都正常，手机上就是不更新」，非常难往这上面想。踩过一次。
$rev = & $adb reverse --list 2>$null
if ($rev -match 'tcp:3000') {
    Write-Host "`n[!] 检测到 adb reverse 隧道还在 —— 你之前可能在用 live 模式。" -ForegroundColor Yellow
    Write-Host "    刚装的是【静态包】，代码固化在 APK 里，改代码手机上不会再更新。" -ForegroundColor Yellow
    Write-Host "    要回 live：npm run android:live" -ForegroundColor Cyan
}
