<#
  正式签名包的唯一打包入口。用法：

      npm run apk:solo        # 单机发行版（交给别人的那份）
      npm run apk:personal    # 自用版（与 NAS 同步）

  这个脚本的价值不在于跑 gradle —— 而在于围着 gradle 的五道闸门
  （1–4 在 gradle 之前查输入，5 在之后查产物）。
  两个变体共用 applicationId、共用 android/app/src/main/assets/public，
  gradle 本身分辨不出「这份 web 产物属于哪个变体」，配错了照样构建成功、
  照样装得上，直到用户发现自己的记录不见了（或者你发现 key 被发出去了）。

  闸门都是「产物自己带着可核对的事实」，不依赖打包的人记得做对。

  ⚠️ 本文件必须存成 UTF-8 **with BOM**：Windows PowerShell 5.1 没有 BOM
     就按 ANSI 读，中文注释会烂成乱码并撑爆字符串语法。已经踩过一次。
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('solo', 'personal')]
    [string]$Flavor
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# 变体 <-> 构建戳 <-> 该跑的 npm 脚本，三者绑定
$matrix = @{
    solo     = @{ Stamp = 'solo'; Build = 'npm run build:solo';    Task = 'assembleSoloRelease';     Out = 'solo/release' }
    personal = @{ Stamp = 'prod'; Build = 'npm run build:release'; Task = 'assemblePersonalRelease'; Out = 'personal/release' }
}
$expect = $matrix[$Flavor]

function Fail($msg, $hint) {
    Write-Host "[X] $msg" -ForegroundColor Red
    if ($hint) { Write-Host "    $hint" -ForegroundColor Yellow }
    exit 1
}
function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }

Write-Host ""
Write-Host "=== 打包 $Flavor (release) ===" -ForegroundColor Cyan
Write-Host ""

# -- 闸门 1：dist 的构建戳必须匹配变体 ---------------------------
# 没有这道闸，`npm run build` 的默认产物（dev 环境）会被打进包里：
# 真实数据不会坏，但手机上看不到自己的记录 —— 只有用户能发现的故障。
$distStampFile = 'dist/fitlog-build-env.json'
if (-not (Test-Path $distStampFile)) { Fail "没有 $distStampFile" "先跑: $($expect.Build)" }
$distStamp = (Get-Content $distStampFile -Raw | ConvertFrom-Json).env
if ($distStamp -ne $expect.Stamp) {
    Fail "dist 的构建戳是 '$distStamp'，$Flavor 变体要求 '$($expect.Stamp)'" "先跑: $($expect.Build)"
}
Ok "dist 构建戳: $distStamp"

# -- 闸门 2：同步进 assets 的那一份必须与 dist 一致 ---------------
# 「dist 是新的、assets/public 是旧的」是这个项目撞过的坑：
# 闸门 1 查的是 dist，装进 APK 的却是 assets —— 只查前者等于没查。
$assetStampFile = 'android/app/src/main/assets/public/fitlog-build-env.json'
if (-not (Test-Path $assetStampFile)) { Fail "没有 $assetStampFile" "先跑: npx cap sync android" }
$assetStamp = (Get-Content $assetStampFile -Raw | ConvertFrom-Json).env
if ($assetStamp -ne $expect.Stamp) {
    Fail "assets 里的构建戳是 '$assetStamp'，与 dist 的 '$distStamp' 不一致" "先跑: npx cap sync android"
}
# 戳一样还不够 —— 同一个变体连打两次，戳不变但内容可能是旧的。比对入口 JS 的哈希文件名。
$distIndex  = (Get-ChildItem 'dist/assets' -Filter 'index-*.js' | Select-Object -First 1).Name
$assetIndex = (Get-ChildItem 'android/app/src/main/assets/public/assets' -Filter 'index-*.js' | Select-Object -First 1).Name
if ($distIndex -ne $assetIndex) {
    Fail "assets 不是最新的 dist（dist: $distIndex / assets: $assetIndex）" "先跑: npx cap sync android"
}
Ok "assets 与 dist 一致: $assetIndex"

# -- 闸门 3：签名配置必须齐备 -------------------------------------
if (-not (Test-Path 'android/key.properties')) {
    Fail "没有 android/key.properties —— 打出来的包不会被签名，装不上手机" "生成方式见 docs/release-signing.md"
}
# -Encoding utf8 不是可选项：默认按 ANSI(936) 读，中文注释的尾字节会吞掉行尾换行、
# 把下一行粘进注释里 —— storeFile 曾因此整行消失。而空字符串 Join-Path 出来正好是
# 'android' 目录、存在、Test-Path 放行，整道闸门空跑了一轮还报 [OK]。
$props = @{}
Get-Content 'android/key.properties' -Encoding utf8 | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)$') { $props[$matches[1]] = $matches[2].Trim() }
}
foreach ($k in @('storeFile', 'storePassword', 'keyAlias', 'keyPassword')) {
    if (-not $props[$k]) { Fail "android/key.properties 缺少 $k（或解析出来是空的）" "四个键都要有值，且该文件必须是纯 ASCII" }
}
$storePath = Join-Path 'android' $props['storeFile']
# -PathType Leaf：必须是文件。目录也能通过裸 Test-Path —— 那正是上面说的那个洞。
if (-not (Test-Path $storePath -PathType Leaf)) { Fail "key.properties 指向的 keystore 不是文件: $storePath" "生成方式见 docs/release-signing.md" }
Ok "签名配置就绪: $($props['storeFile']) (alias: $($props['keyAlias']))"

# -- JAVA_HOME ---------------------------------------------------
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
    $candidates = @(
        "D:\tools\Android_studio\install\jbr",
        "C:\Program Files\Android\Android Studio\jbr",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
    )
    $found = $candidates | Where-Object { Test-Path "$_\bin\java.exe" } | Select-Object -First 1
    if (-not $found) { Fail "找不到 JDK" "设置 JAVA_HOME，或改本脚本的 candidates 列表" }
    $env:JAVA_HOME = $found
}
Write-Host "[i] JAVA_HOME = $env:JAVA_HOME" -ForegroundColor DarkGray

# -- 构建 --------------------------------------------------------
Push-Location 'android'
try {
    & '.\gradlew.bat' ":app:$($expect.Task)" --console=plain
    if ($LASTEXITCODE -ne 0) { throw "gradle 失败" }
} finally {
    Pop-Location
}

$apk = Get-ChildItem "android/app/build/outputs/apk/$($expect.Out)" -Filter '*.apk' | Select-Object -First 1
if (-not $apk) { Fail "构建成功但找不到 APK" $null }
$sizeMb = [math]::Round($apk.Length / 1MB, 1)
Ok "APK: $($apk.FullName)  ($sizeMb MB)"

# -- 闸门 4：单机版必须证明「真的没带 key 和 NAS 地址」 -----------
# 前面所有检查证明的都是「我构建的东西是干净的」。
# 这一道查的是**要发出去的那个文件本身** —— 唯一能证明没漏的检查。
if ($Flavor -eq 'solo') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)
    try {
        $needles = New-Object System.Collections.Generic.List[string]
        $needles.Add('taild995c6')
        $needles.Add('hometj')
        if (Test-Path '.env.local') {
            $line = Get-Content '.env.local' | Where-Object { $_ -match '^VITE_API_KEY=' } | Select-Object -First 1
            if ($line) { $needles.Add((($line -split '=', 2)[1]).Trim().Trim('"')) }
        }
        $hits = New-Object System.Collections.Generic.List[string]
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -notlike 'assets/public/*') { continue }
            if ($entry.FullName -notmatch '\.(js|html|json|css)$') { continue }
            $reader = New-Object System.IO.StreamReader($entry.Open())
            $text = $reader.ReadToEnd()
            $reader.Close()
            foreach ($n in $needles) {
                if ($n -and $text.Contains($n)) {
                    $shown = $n.Substring(0, [Math]::Min(8, $n.Length))
                    $hits.Add("$($entry.FullName) 命中: $shown...")
                }
            }
        }
        if ($hits.Count -gt 0) {
            foreach ($h in $hits) { Write-Host "    $h" -ForegroundColor Red }
            Fail "APK 里仍然带着凭据或 NAS 地址 —— 这个包不能发" "检查 .env.solo 是否混入了 VITE_API_* 变量"
        }
        Ok "APK 内容体检通过: 无 NAS 地址、无 API key"
    } finally { $zip.Dispose() }
}

# -- 闸门 5：产出的 APK 必须真的被签了 ---------------------------
# 闸门 3 查的是「签名配置齐备」，那是**输入**。
# 签名真没生效时（signingConfig 没挂上、gradle 静默降级），
# 构建照样 BUILD SUCCESSFUL、APK 照样产出，只是装不上 —— 而「装不上」
# 要等到推给用户才发现。这里直接问产物本身。
$sdkDir = $null
if (Test-Path 'android/local.properties') {
    foreach ($line in (Get-Content 'android/local.properties' -Encoding utf8)) {
        if ($line -match '^\s*sdk\.dir\s*=\s*(.+?)\s*$') {
            # java .properties 把反斜杠和冒号都转义了：C\:\Users\... 要还原成 C:\Users\...
            # 一条规则搞定：反斜杠转义下一个字符。\: -> :  和  \ -> \  都被它覆盖，
            # 不用分两步，也就没有「先替哪个」的顺序坑。
            $sdkDir = [regex]::Replace($matches[1], '\\(.)', '$1')
        }
    }
}
if (-not $sdkDir -or -not (Test-Path $sdkDir)) { $sdkDir = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$apksigner = Get-ChildItem (Join-Path $sdkDir 'build-tools') -Filter 'apksigner.bat' -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $apksigner) {
    Write-Host "[!] 找不到 apksigner，跳过签名校验 —— 这个包没被证明签过" -ForegroundColor Yellow
} else {
    $out = & $apksigner.FullName verify --print-certs $apk.FullName 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $out -notmatch 'certificate SHA-256 digest:\s*([0-9a-f]{64})') {
        Write-Host $out -ForegroundColor Red
        Fail "APK 未通过签名校验 —— 装不上手机" "检查 android/key.properties 的口令是否正确"
    }
    $fp = $matches[1]
    Ok "签名有效 · SHA-256 $($fp.Substring(0,8))...$($fp.Substring(56))"
    Write-Host "    完整指纹: $fp" -ForegroundColor DarkGray
    Write-Host "    换密钥会让已装用户无法更新 —— 指纹变了就是换了密钥" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "完成。" -ForegroundColor Green
Write-Host ""
