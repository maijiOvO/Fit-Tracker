<#
  健身房热修：一条命令打出自用版正式签名包，核对后放进 tailnet 下载目录。用法：

      npm run gym:ship

  手机（开着 Tailscale）打开脚本最后打印的网址，下载、覆盖安装。
  流程和注意事项在 .claude/skills/gym-hotfix/SKILL.md。

  打包本身仍走 build-apk.ps1（五道闸门都在那里）。这里多做三件事：
    - 给产物烙一个构建戳（首选项最底下那行），下载页上写同一个戳
    - 发布前从 APK 里把戳读回来，证明要发的这个文件就是这次的代码
    - 下载目录留最近 4 个包，新包有问题能装回上一个

  ⚠️ 本文件必须存成 UTF-8 **with BOM**（理由同 build-apk.ps1 文件头）。
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# 放仓库外的固定目录：包里带 NAS 地址和 key，不进任何工作树；工作树里打的包也发到同一处
$drop = Join-Path $env:LOCALAPPDATA 'fitlog-gym'
$servePort = 8443
$keep = 4

function Fail($msg, $hint) {
    Write-Host "[X] $msg" -ForegroundColor Red
    if ($hint) { Write-Host "    $hint" -ForegroundColor Yellow }
    exit 1
}
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }

$watch = [Diagnostics.Stopwatch]::StartNew()

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

$manifestPath = Join-Path $drop 'builds.json'
$builds = @()
# 外面那层括号不能省：PS 5.1 的 ConvertFrom-Json 把整个数组当一个对象吐出来，不先展开就成了「只有一项的数组」
if (Test-Path $manifestPath) { $builds = @((Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json) | ForEach-Object { $_ }) }
$entry = [pscustomobject]@{
    file  = $name
    stamp = $stamp
    at    = (Get-Date -Format 'MM-dd HH:mm')
    mb    = [math]::Round($apk.Length / 1MB, 1)
}
$builds = @($entry) + @($builds | Where-Object { $_.file -ne $name -and (Test-Path (Join-Path $drop $_.file)) })
foreach ($old in ($builds | Select-Object -Skip $keep)) { Remove-Item -LiteralPath (Join-Path $drop $old.file) -Force }
$builds = @($builds | Select-Object -First $keep)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($manifestPath, (ConvertTo-Json -InputObject $builds), $utf8)

$rows = for ($i = 0; $i -lt $builds.Count; $i++) {
    $b = $builds[$i]
    $cls = if ($i -eq 0) { 'apk new' } else { 'apk' }
    $tag = if ($i -eq 0) { '最新' } else { '旧包' }
    "<a class=`"$cls`" href=`"$($b.file)`" download><b>$($b.stamp)</b><span>$tag · $($b.at) · $($b.mb) MB</span></a>"
}
$html = @"
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fit Tracker 热修包</title>
<style>
  body { margin: 0; padding: 24px 16px; font: 16px/1.5 system-ui, sans-serif; background: #f4f4f2; color: #1c1c1a; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 20px; color: #6b6b66; font-size: 14px; }
  .apk { display: block; padding: 16px; margin-bottom: 12px; border-radius: 14px; background: #fff; color: inherit; text-decoration: none; border: 1px solid #e2e2de; }
  .apk.new { background: #1c1c1a; color: #fff; border-color: #1c1c1a; }
  .apk b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
  .apk span { font-size: 13px; opacity: .7; }
  @media (prefers-color-scheme: dark) {
    body { background: #141413; color: #ecece8; }
    p { color: #9a9a94; }
    .apk { background: #1f1f1d; border-color: #33332f; }
    .apk.new { background: #ecece8; color: #141413; border-color: #ecece8; }
  }
</style>
<h1>Fit Tracker 热修包</h1>
<p>装完到「我的 › 首选项」最底下，看到同一个戳就是装上了。</p>
$($rows -join "`n")
</html>
"@
[IO.File]::WriteAllText((Join-Path $drop 'index.html'), $html, $utf8)
Ok "已发布: $name（下载目录留最近 $($builds.Count) 个）"

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
