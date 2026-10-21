# 一键：构建 → 同步 → 打 APK → 装到手机
#
#   .\scripts\deploy-android.ps1            # prod 数据环境（连 NAS 真实数据）
#   .\scripts\deploy-android.ps1 -SkipBuild # 只重装现有 APK，不重新编译
#
# 没有 dev 包。原生 App 运行时一律锁 prod（services/appEnv.ts 的 isEnvLocked()），
# 构建戳写 dev 也没用 —— 以前的 -Dev 打出来的包装上手机照样连 NAS 真实 state。
# 要在手机上造假数据，用不联网的 solo 测试包（android-build 技能第 5 节末）。
# -Dev 参数留着只为报错拦住旧习惯。
#
# 不用连 USB 也能出 APK —— 只是最后那步装不上，脚本会把文件路径告诉你。
#
# ⚠️ 正在用 live 模式开发时，别为了「看新图标」跑这个脚本 —— 它打的是静态包，
#    一装就把 live 顶掉了。live 包也是从同一份 res/ 编出来的，
#    图标、启动图、原生配置这些照样在里面，所以那种情况直接跑：
#      npm run android:live
#    本脚本只在你要一个【离开数据线也能用】的包时才需要。

param(
    [switch]$Dev,  # 已废弃，传了就报错，见文件头
    [switch]$SkipBuild,
    [ValidateSet('personal')]  # solo 的 web 侧要 build:solo，本脚本只打 prod，不接 solo
    [string]$Variant = 'personal'
)

$ErrorActionPreference = 'Stop'

if ($Dev) {
    Write-Host "[X] -Dev 已删除：它打出的包装到手机上照样是 prod、照样读写 NAS 真实数据。" -ForegroundColor Red
    Write-Host "    原生 App 运行时一律锁 prod（services/appEnv.ts 的 isEnvLocked()），构建戳管不到。" -ForegroundColor Yellow
    Write-Host "    要在手机上造假数据 / 做破坏性验证，用不联网的 solo 测试包：" -ForegroundColor Yellow
    Write-Host "    FITLOG_TEST_PKG=1 + build:solo + assembleSoloDebug，见 .claude/skills/android-build/SKILL.md 第 5 节末。" -ForegroundColor Cyan
    exit 1
}

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
# 有了 personal / solo 变体之后 debug 包按变体分目录；原先的 apk\debug\app-debug.apk 已经不存在
$apk = "android\app\build\outputs\apk\$Variant\debug\app-$Variant-debug.apk"
$pkg = 'com.myron.fittracker'
$task = 'assemble' + $Variant.Substring(0, 1).ToUpper() + $Variant.Substring(1) + 'Debug'

if (-not $SkipBuild) {
    # ── 1. 构建 web 产物 ──────────────────────────────────
    $mode = 'prod'
    Write-Host "`n[1/4] 构建 web 产物（$mode 数据环境）..." -ForegroundColor Cyan
    npm run build:release
    if ($LASTEXITCODE -ne 0) { Write-Host "[X] web 构建失败" -ForegroundColor Red; exit 1 }

    # 环境戳闸门：确认 dist 是 release 构建，不是 dist 里残留的 dev / demo / solo 产物。
    # （运行时手机本来就锁 prod；这道闸门管的是 release 才有的构建期配置别漏掉。）
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
    Write-Host "`n[3/4] gradlew $task..." -ForegroundColor Cyan
    . "$PSScriptRoot\gradleDaemon.ps1"
    Start-GradleDaemonDetached (Join-Path $root 'android')
    Push-Location android
    & ".\gradlew.bat" $task --console=plain
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
    Write-Host "    卸载后重装：adb uninstall $pkg" -ForegroundColor Yellow
    Write-Host "    本地数据会清掉，但训练记录在 NAS 上，重装后会同步回来。" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n[OK] 装好了。" -ForegroundColor Green
& $adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 | Out-Null
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
