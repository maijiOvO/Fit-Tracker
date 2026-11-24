<#
  健身房热修：一条命令打出自用版正式签名包，核对后放进 tailnet 下载目录。用法：

      npm run gym:ship

  手机（开着 Tailscale）打开脚本最后打印的网址，下载、覆盖安装。
  流程和注意事项在 .claude/skills/gym-hotfix/SKILL.md。

  跑之前设环境变量 GYM_NOTE 说明这个包改了什么（一行一条），它会写在下载页上：

      $env:GYM_NOTE = "修了递减组不继承重量`n加片按钮挪到大图下面"; npm run gym:ship

  打包本身仍走 build-apk.ps1（五道闸门都在那里）。这里多做三件事：
    - 给产物烙一个构建戳（首选项最底下那行），下载页上写同一个戳
    - 发布前从 APK 里把戳读回来，证明要发的这个文件就是这次的代码
    - 下载页只放这一个包和它的改动说明，旧包随即删掉

  ⚠️ 本文件必须存成 UTF-8 **with BOM**（理由同 build-apk.ps1 文件头）。
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# 放主仓旁边的固定目录：包里带 NAS 地址和 key，不进任何工作树；工作树里打的包也发到同一处（所以按 git 公共目录找主仓）。
# 不能放 %LOCALAPPDATA%：Claude 桌面版是 MSIX 应用，它起的进程往 AppData 写会被重定向进
# Packages\Claude_*\LocalCache，自己 ls 看得到，tailscaled 去读真路径却是空的，下载页一律 404。
$mainRepo = Split-Path -Parent (Resolve-Path (& git rev-parse --git-common-dir)).Path
$drop = Join-Path (Split-Path -Parent $mainRepo) 'fitlog-gym'
$servePort = 8443

function Fail($msg, $hint) {
    Write-Host "[X] $msg" -ForegroundColor Red
    if ($hint) { Write-Host "    $hint" -ForegroundColor Yellow }
    exit 1
}
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }

$watch = [Diagnostics.Stopwatch]::StartNew()

# 下载页上「这个包改了什么」，一行一条，写给拿着手机的人看。走环境变量是因为中文经 npm 传命令行参数会烂码
$note = "$env:GYM_NOTE".Trim()
if (-not $note) { Fail "没说这个包改了什么" "先设环境变量 GYM_NOTE（一行一条，用户能看懂的话），再跑 npm run gym:ship" }

# -- 前置 ---------------------------------------------------------
# 工作树里常缺 .env.local：照样构建成功，但包里没有 NAS 地址，装上去不同步
if (-not (Test-Path '.env.local')) { Fail "没有 .env.local" "从主仓复制一份过来再打" }
# 残留的 live 开关会让 cap sync 写进 server.url，装上去离开数据线就白屏
$env:CAP_LIVE_RELOAD = $null

$commit = (& git rev-parse --short HEAD).Trim()
# docs 下的随手笔记不算改动；其余没提交的改动标一个 +
$dirty = if (& git status --porcelain -- . ':!docs') { '+' } else { '' }
$time = Get-Date -Format 'MMdd-HHmm'
$stamp = "$time $commit$dirty"
$env:VITE_BUILD_STAMP = $stamp
Write-Host ""
Write-Host "=== 健身房热修包 · $stamp ===" -ForegroundColor Cyan

# -- 构建 ---------------------------------------------------------
& npm run build:release
if ($LASTEXITCODE -ne 0) { Fail "web 构建失败" $null }
& npx cap sync android
if ($LASTEXITCODE -ne 0) { Fail "cap sync 失败" $null }

$capCfg = Get-Content 'android/app/src/main/assets/capacitor.config.json' -Raw -Encoding utf8 | ConvertFrom-Json
if ($capCfg.server -and $capCfg.server.url) { Fail "capacitor.config.json 里带着 server.url（$($capCfg.server.url)）" "这是 live 包的配置，离开数据线必白屏" }

& "$PSScriptRoot\build-apk.ps1" -Flavor personal
if ($LASTEXITCODE -ne 0) { exit 1 }

$apk = Get-ChildItem 'android/app/build/outputs/apk/personal/release' -Filter '*.apk' | Select-Object -First 1
if (-not $apk) { Fail "找不到 personal release APK" $null }

# -- 核对：要发的这个文件就是这次的代码 ----------------------------
# 闸门管的是「这次构建对不对」，管不到「这个 APK 是不是这次构建的」（docs/release-signing.md 第 3 步）
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)
try {
    $inApk = $zip.Entries |
        Where-Object { $_.FullName -like 'assets/public/*' -and -not $_.FullName.EndsWith('/') } |
        ForEach-Object { $_.FullName.Substring('assets/public/'.Length) }
    $distRoot = (Resolve-Path 'dist').Path
    $inDist = Get-ChildItem 'dist' -Recurse -File | ForEach-Object { $_.FullName.Substring($distRoot.Length + 1).Replace('\', '/') }
    # 这三个差异是固定的：前两个由 Capacitor 注入，点文件被 aapt 排除
    $expected = @('cordova.js', 'cordova_plugins.js', 'fonts/.charset-hash')
    $odd = Compare-Object $inApk $inDist | Where-Object { $expected -notcontains $_.InputObject }
    if ($odd) {
        $odd | ForEach-Object { Write-Host "    $($_.InputObject) $($_.SideIndicator)" -ForegroundColor Red }
        Fail "APK 里的文件和 dist 对不上，这个包不是这次构建的" "<= 只在 APK 里，=> 只在 dist 里"
    }

    $hasStamp = $false
    $hasRemote = $false
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -notlike 'assets/public/assets/*.js') { continue }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        $text = $reader.ReadToEnd()
        $reader.Close()
        if ($text.Contains($stamp)) { $hasStamp = $true }
        if ($text.Contains('taild995c6')) { $hasRemote = $true }
    }
    if (-not $hasStamp) { Fail "APK 里读不到构建戳 '$stamp'" "包里是旧代码" }
    if (-not $hasRemote) { Fail "APK 里没有 NAS 地址，装上去不会同步" "检查 .env.local 的 VITE_API_URL" }
} finally { $zip.Dispose() }
Ok "APK 与 dist 一致，构建戳和 NAS 地址都在包里"

# -- 发布到下载目录 -----------------------------------------------
if (-not (Test-Path $drop)) { New-Item -ItemType Directory -Path $drop | Out-Null }
$name = "fit-tracker-$time.apk"
Copy-Item $apk.FullName (Join-Path $drop $name) -Force

# 下载页上只放这一个包：旧的删掉，免得装错
Get-ChildItem $drop -Filter 'fit-tracker-*.apk' -File | Where-Object { $_.Name -ne $name } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$noteHtml = (($note -split "`n") | ForEach-Object { '<li>' + [System.Net.WebUtility]::HtmlEncode($_.Trim()) + '</li>' }) -join "`n"
$at = Get-Date -Format 'M 月 d 日 HH:mm'
$mb = [math]::Round($apk.Length / 1MB, 1)
$html = @"
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fit Tracker 热修包</title>
<style>
  body { margin: 0; padding: 24px 16px; font: 16px/1.5 system-ui, sans-serif; background: #f4f4f2; color: #1c1c1a; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: #6b6b66; font-size: 14px; }
  ul { margin: 0 0 20px; padding: 14px 16px 14px 34px; border-radius: 14px; background: #fff; border: 1px solid #e2e2de; }
  li + li { margin-top: 6px; }
  .apk { display: block; padding: 16px; margin-bottom: 12px; border-radius: 14px; background: #1c1c1a; color: #fff; text-decoration: none; text-align: center; font-size: 18px; font-weight: 600; }
  code { font: inherit; font-variant-numeric: tabular-nums; color: inherit; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { background: #141413; color: #ecece8; }
    p { color: #9a9a94; }
    ul { background: #1f1f1d; border-color: #33332f; }
    .apk { background: #ecece8; color: #141413; }
  }
</style>
<h1>Fit Tracker 最新包</h1>
<p>$at 打包 · $mb MB</p>
<ul>
$noteHtml
</ul>
<a class="apk" href="$name" download>下载安装</a>
<p>装完到「我的 › 首选项」最底下，看到 <code>$stamp</code> 就是装上了。</p>
</html>
"@
[IO.File]::WriteAllText((Join-Path $drop 'index.html'), $html, $utf8)
Ok "已发布: $name（已替换掉旧包）"

# -- 下载地址 -----------------------------------------------------
$tailscale = Get-Command tailscale -ErrorAction SilentlyContinue
$serveStatus = if ($tailscale) { (& tailscale serve status | Out-String) } else { '' }
$secs = [math]::Round($watch.Elapsed.TotalSeconds)
Write-Host ""
if ($serveStatus -match ":$servePort\b") {
    $hostLine = ($serveStatus -split "`n" | Where-Object { $_ -match "^https://\S+:$servePort" } | Select-Object -First 1)
    Write-Host "完成，用时 $secs 秒。手机打开：$(($hostLine -split '\s')[0])/" -ForegroundColor Green
} else {
    Write-Host "包打好了（用时 $secs 秒），但下载目录还没挂到 tailnet。一次性执行：" -ForegroundColor Yellow
    Write-Host "    tailscale serve --bg --https=$servePort `"$drop`"" -ForegroundColor Cyan
}
Write-Host ""
