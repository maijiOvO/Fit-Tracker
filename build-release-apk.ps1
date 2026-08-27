# 构建发布版APK脚本
# 此脚本将构建带签名的发布版APK

Write-Host "🚀 开始构建发布版APK..." -ForegroundColor Green

# 检查是否在正确的目录
if (!(Test-Path "android/app/build.gradle")) {
    Write-Host "❌ 请在项目根目录运行此脚本" -ForegroundColor Red
    exit 1
}

# 检查签名配置
if (!(Test-Path "android/key.properties")) {
    Write-Host "❌ 未找到签名配置文件" -ForegroundColor Red
    Write-Host "请先运行 setup-release-build.ps1 设置签名" -ForegroundColor Yellow
    exit 1
}

# 检查密钥库文件
if (!(Test-Path "android/app/fitlog-release-key.keystore")) {
    Write-Host "❌ 未找到密钥库文件" -ForegroundColor Red
    Write-Host "请先运行 setup-release-build.ps1 生成密钥库" -ForegroundColor Yellow
    exit 1
}

# ============================================================
# 数据环境闸门：确认 dist 是 release 构建（VITE_FITLOG_ENV=prod）
# ============================================================
# 用 `npm run build` 打出来的包默认是 dev 环境，装到手机上会去读写
# state-dev —— 真实数据不会被破坏，但手机上会看不到自己的记录。
$envStamp = "dist/fitlog-build-env.json"
if (!(Test-Path $envStamp)) {
    Write-Host "[X] 未找到 $envStamp —— 请先运行: npm run build:release" -ForegroundColor Red
    exit 1
}
$builtEnv = (Get-Content $envStamp -Raw | ConvertFrom-Json).env
if ($builtEnv -ne "prod") {
    Write-Host "[X] dist 是 '$builtEnv' 环境构建，不能用于发布" -ForegroundColor Red
    Write-Host "    请运行: npm run build:release  然后 npx cap sync android" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] dist 环境戳: prod" -ForegroundColor Green

# 清理之前的构建
Write-Host "🧹 清理之前的构建..." -ForegroundColor Yellow
try {
    Set-Location "android"
    & "./gradlew.bat" clean
    if ($LASTEXITCODE -ne 0) {
        throw "清理失败"
    }
    Write-Host "✅ 清理完成" -ForegroundColor Green
} catch {
    Write-Host "❌ 清理失败: $_" -ForegroundColor Red
    Set-Location ".."
    exit 1
}

# 构建发布版APK
Write-Host "🔨 构建发布版APK..." -ForegroundColor Yellow
try {
    & "./gradlew.bat" assembleRelease
    if ($LASTEXITCODE -ne 0) {
        throw "构建失败"
    }
    Write-Host "✅ APK构建成功!" -ForegroundColor Green
} catch {
    Write-Host "❌ 构建失败: $_" -ForegroundColor Red
    Set-Location ".."
    exit 1
}

Set-Location ".."

# 检查输出文件
$apkPath = "android/app/build/outputs/apk/release/app-release.apk"
if (Test-Path $apkPath) {
    $apkSize = (Get-Item $apkPath).Length / 1MB
    Write-Host "🎉 APK构建成功!" -ForegroundColor Green
    Write-Host "📱 APK位置: $apkPath" -ForegroundColor Cyan
    Write-Host "📏 APK大小: $([math]::Round($apkSize, 2)) MB" -ForegroundColor Cyan
    
    # 显示APK信息
    Write-Host "`n📋 APK信息:" -ForegroundColor Yellow
    try {
        # 尝试使用aapt显示APK信息（如果可用）
        $aaptPath = Get-ChildItem -Path "C:\Users\$env:USERNAME\AppData\Local\Android\Sdk\build-tools" -Recurse -Name "aapt.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($aaptPath) {
            $fullAaptPath = "C:\Users\$env:USERNAME\AppData\Local\Android\Sdk\build-tools\$aaptPath"
            & $fullAaptPath dump badging $apkPath | Select-String "package:|application-label:|versionCode:|versionName:"
        }
    } catch {
        Write-Host "无法获取详细APK信息" -ForegroundColor Yellow
    }
    
    Write-Host "`n🎯 下一步:" -ForegroundColor Green
    Write-Host "  1. 在真实设备上测试APK" -ForegroundColor Yellow
    Write-Host "  2. 确认所有功能正常工作" -ForegroundColor Yellow
    Write-Host "  3. 准备发布到应用商店或分发" -ForegroundColor Yellow
    
} else {
    Write-Host "❌ 未找到构建的APK文件" -ForegroundColor Red
    exit 1
}