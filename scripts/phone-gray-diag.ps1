# 锁屏回来 App 全灰：在清后台之前，先把系统侧证据抓下来（全部只读，不 force-stop、不 input）。
#
#   .\scripts\phone-gray-diag.ps1
#
# 产出：
#   test-artifacts\gray-<时间戳>.log   logcat 全量（所有缓冲区），事后慢慢翻
#   终端                               过滤后的关键行 + 进程 / 内存 / 屏幕状态摘要
#
# 两种假设各看什么：
#   A）弹窗遮罩残留（.bg-scrim）——系统侧看不出来，要靠第二步 node scripts\phone-webview-probe.mjs 进 WebView 内部数
#   B）WebView 没在画（渲染进程被杀 / 冻结 / 卡死）——看 logcat 里的 "Render process"、ANR、lowmemorykiller、
#      以及 dumpsys 里主进程和 sandboxed_process 的 isFrozen / procState
#
# 前提：手机插线并开 USB 调试。本脚本不依赖 WebView 调试，正式包也能跑；
# 第二步的 CDP 探针只对 debug / 测试包可用（正式签名包不开 WebView 调试）。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pkg = 'com.myron.fittracker'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

function Section($title) { Write-Host "`n== $title ==" -ForegroundColor Cyan }

# /proc 状态 + cgroup v2 的 freeze 位：dumpsys 的 isFrozen 只反映 AMS 自己的冻结器，
# 小米另有一套，实测 isFrozen=false 时 cgroup.freeze 已经是 1。两处都看。
function Show-Freeze($targetPid) {
    & $adb shell "cat /proc/$targetPid/status | grep -E '^(State|VmRSS|Threads)'" | ForEach-Object { Write-Host "    $_" }
    $cg = (& $adb shell "cat /proc/$targetPid/cgroup | grep '^0::'" | Out-String).Trim()
    if ($cg) {
        $cgPath = $cg.Substring($cg.IndexOf('::') + 2)
        $frz = (& $adb shell "cat /sys/fs/cgroup$cgPath/cgroup.freeze 2>/dev/null" | Out-String).Trim()
        if ($frz) { Write-Host "    cgroup.freeze=$frz  ($cgPath；1 = 被系统冻结，前台时应为 0)" }
    }
}

# ── adb / 设备 ──────────────────────────────────────────────
if (-not (Test-Path $adb)) {
    Write-Host "[X] 找不到 adb：$adb" -ForegroundColor Red
    exit 1
}
$devices = & $adb devices | Select-String -Pattern "\tdevice$"
if (-not $devices) {
    Write-Host "[X] 没有已连接的设备。插线，并在手机上点「允许 USB 调试」。" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] 设备：$(($devices | Select-Object -First 1).Line.Trim())" -ForegroundColor Green

# adb 输出里有中文（小米系统日志、App 文案），按 UTF-8 解码再落盘，否则全是问号。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$utf8 = New-Object System.Text.UTF8Encoding $false

# ── 当前屏幕 / 前台 ─────────────────────────────────────────
# 先于一切：mWakefulness=Dozing/Asleep 时 WebView 本来就不画，后面所有「没响应」都不作数（见 phone-webview-cdp 记忆）。
Section '屏幕与前台'
& $adb shell dumpsys power | Select-String -Pattern 'mWakefulness=' | ForEach-Object { Write-Host "  $($_.Line.Trim())" }
& $adb shell dumpsys window | Select-String -Pattern 'mCurrentFocus|mFocusedApp' | Select-Object -First 2 | ForEach-Object { Write-Host "  $($_.Line.Trim())" }
& $adb shell dumpsys webviewupdate | Select-String -Pattern 'Current WebView package' | ForEach-Object { Write-Host "  $($_.Line.Trim())" }

# ── logcat 全量落盘 ─────────────────────────────────────────
Section 'logcat'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $root 'test-artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$log = Join-Path $outDir "gray-$stamp.log"
$lines = @(& $adb logcat -d -b all -v threadtime)
[System.IO.File]::WriteAllLines($log, $lines, $utf8)
Write-Host "  全量 $($lines.Count) 行 -> $log" -ForegroundColor DarkGray

# 关键行：WebView / Chromium 自身、渲染进程没了、ANR、被系统杀、以及一切带包名的。
# 必须区分大小写 + 词边界：不然 ANR 会命中 ScanResult / EutranRegistration 之类，一屏全是蓝牙扫描。
$keyPattern = 'chromium|WebView|\bcr_|\bANR\b|Render process|Not responding|fittracker|SandboxedProcessService|lowmemorykiller|am_kill|am_anr|am_proc_died|am_freeze|am_unfreeze'
$key = @($lines | Select-String -CaseSensitive -Pattern $keyPattern)
# 高价值行单独再挑一遍，免得被包名行淹没。
$hot = @($key | Select-String -CaseSensitive -Pattern 'Render process|Not responding|\bANR\b|lowmemorykiller|am_kill|am_anr|am_proc_died|am_freeze|am_unfreeze|crash|FATAL')
Write-Host "  匹配关键行 $($key.Count) 条，其中高价值（杀进程 / ANR / 渲染进程 / 冻结）$($hot.Count) 条" -ForegroundColor DarkGray
if ($hot.Count -gt 0) {
    Write-Host "  -- 高价值行（最多最后 40 条）--" -ForegroundColor Yellow
    $hot | Select-Object -Last 40 | ForEach-Object { Write-Host "  $($_.Line)" }
}
Write-Host "  -- 关键行（最后 60 条；全部在日志文件里）--" -ForegroundColor Yellow
$key | Select-Object -Last 60 | ForEach-Object { Write-Host "  $($_.Line)" }

# ── 进程状态 ────────────────────────────────────────────────
Section '进程'
$pid_ = (& $adb shell pidof $pkg | Out-String).Trim()
if (-not $pid_) {
    Write-Host "  [!] $pkg 进程不在 —— 已经被杀 / 被清后台。灰屏时若是这个状态，看上面 am_kill / lowmemorykiller 行是谁杀的。" -ForegroundColor Yellow
} else {
    Write-Host "  主进程 pid=$pid_" -ForegroundColor Green
    Show-Freeze $pid_
}

# dumpsys activity processes：主进程一块，再按 uid 找到替它渲染的 chromium sandboxed_process（渲染进程，跑在隔离 uid 下，
# 名字里没有包名，只能靠 /u0a<appId>i 后缀认），各挑状态行。渲染进程被杀 / 被冻结而主进程还在，正是假设 B 的形态。
$procDump = @(& $adb shell dumpsys activity processes)
$appIdx = @()
for ($i = 0; $i -lt $procDump.Count; $i++) {
    if ($procDump[$i] -match '^\s*\*APP\* UID (\d+) ProcessRecord\{\S+ (\d+):com\.myron\.fittracker/') {
        $appIdx += $i
        $appId = [int]$Matches[1] - 10000
        for ($k = 0; $k -lt $procDump.Count; $k++) {
            if ($procDump[$k] -match "^\s*\*APP\* UID \d+ ProcessRecord\{\S+ (\d+):\S*sandboxed_process\S*/u0a${appId}i\d+\}") { $appIdx += $k }
        }
    }
}
if ($appIdx.Count -eq 0) {
    Write-Host "  dumpsys activity processes 里没有 $pkg 的 ProcessRecord" -ForegroundColor Yellow
}
foreach ($start in $appIdx) {
    Write-Host "  $($procDump[$start].Trim())" -ForegroundColor Green
    $j = $start + 1
    while ($j -lt $procDump.Count -and $j -lt ($start + 80) -and $procDump[$j] -notmatch '^\s*\*APP\*') {
        if ($procDump[$j] -match 'pid=|Adj=|procState|SchedGroup|isFrozen|lastCompact|lastPss|lastRss|killed|lastActivityTime|lastTopTime|hasActivities|renderThread') {
            Write-Host "    $($procDump[$j].Trim())"
        }
        $j++
    }
    if ($procDump[$start] -match 'sandboxed_process' -and $procDump[$start] -match 'ProcessRecord\{\S+ (\d+):') {
        Write-Host "    （渲染进程）" -ForegroundColor DarkGray
        Show-Freeze $Matches[1]
    }
}
if ($appIdx.Count -eq 1) {
    Write-Host "  [!] 只有主进程，没有属于它的 sandboxed_process —— WebView 渲染进程不在，页面不可能在画。" -ForegroundColor Yellow
}
# LRU 位置：cch 表示进了缓存队列，是被冻结 / 被杀的前一站。
$procDump | Select-String -CaseSensitive -Pattern 'Proc #.*fittracker' | ForEach-Object { Write-Host "  $($_.Line.Trim())" }

# ── 内存 ────────────────────────────────────────────────────
Section '内存'
& $adb shell dumpsys meminfo $pkg | Select-String -Pattern 'MEMINFO|TOTAL PSS|Java Heap|Native Heap:|Graphics:|No process found' | ForEach-Object { Write-Host "  $($_.Line.Trim())" }
& $adb shell cat /proc/meminfo | Select-String -Pattern '^(MemTotal|MemAvailable|SwapFree)' | ForEach-Object { Write-Host "  $($_.Line.Trim())" }

Write-Host ""
Write-Host "系统侧证据已存：$log" -ForegroundColor Green
Write-Host "接着跑 node scripts\phone-webview-probe.mjs 看页面内部（遮罩数、主线程是否堵住）。" -ForegroundColor Cyan
