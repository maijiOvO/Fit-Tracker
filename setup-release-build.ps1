# Android发布版APK自动构建脚本
# 此脚本将帮助你设置和构建带签名的发布版APK

param(
    [string]$KeystorePassword = "",
    [string]$KeyAlias = "fitlog-key-alias",
    [string]$AppName = "FitTracker",
    [string]$OrganizationName = "MyronDev"
)

Write-Host "🚀 开始设置Android发布版构建环境..." -ForegroundColor Green

# 检查Java环境
Write-Host "📋 检查Java环境..." -ForegroundColor Yellow
try {
    $javaVersion = java -version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Java已安装: $($javaVersion[0])" -ForegroundColor Green
    } else {
        throw "Java未找到"
    }
} catch {
    Write-Host "❌ Java未安装或未在PATH中" -ForegroundColor Red
    Write-Host "请先安装Java JDK 11或更高版本:" -ForegroundColor Yellow
    Write-Host "  1. 访问 https://adoptium.net/" -ForegroundColor Yellow
    Write-Host "  2. 下载并安装JDK" -ForegroundColor Yellow
    Write-Host "  3. 设置JAVA_HOME环境变量" -ForegroundColor Yellow
    exit 1
}

# 检查keytool
Write-Host "📋 检查keytool..." -ForegroundColor Yellow
try {
    keytool -help | Out-Null
    Write-Host "✅ keytool可用" -ForegroundColor Green
} catch {
    Write-Host "❌ keytool未找到" -ForegroundColor Red
    exit 1
}

# 创建密钥库目录
$keystoreDir = "android/app"
if (!(Test-Path $keystoreDir)) {
    New-Item -ItemType Directory -Path $keystoreDir -Force
}

$keystorePath = "$keystoreDir/fitlog-release-key.keystore"

# 检查是否已存在密钥库
if (Test-Path $keystorePath) {
    Write-Host "⚠️  密钥库已存在: $keystorePath" -ForegroundColor Yellow
    $overwrite = Read-Host "是否要重新生成密钥库? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "使用现有密钥库..." -ForegroundColor Green
    } else {
        Remove-Item $keystorePath -Force
    }
}

# 生成密钥库
if (!(Test-Path $keystorePath)) {
    Write-Host "🔐 生成签名密钥库..." -ForegroundColor Yellow
    
    if ([string]::IsNullOrEmpty($KeystorePassword)) {
        $KeystorePassword = Read-Host "请输入密钥库密码 (至少6个字符)" -AsSecureString
        $KeystorePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($KeystorePassword))
    }
    
    $keystoreCmd = @"
keytool -genkey -v -keystore "$keystorePath" -alias "$KeyAlias" -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=$AppName, OU=$OrganizationName, O=$OrganizationName, L=Beijing, S=Beijing, C=CN" -storepass "$KeystorePassword" -keypass "$KeystorePassword"
"@
    
    try {
        Invoke-Expression $keystoreCmd
        Write-Host "✅ 密钥库生成成功!" -ForegroundColor Green
    } catch {
        Write-Host "❌ 密钥库生成失败: $_" -ForegroundColor Red
        exit 1
    }
}

# 创建key.properties文件
$keyPropertiesPath = "android/key.properties"
Write-Host "📝 创建key.properties文件..." -ForegroundColor Yellow

if ([string]::IsNullOrEmpty($KeystorePassword)) {
    $KeystorePassword = Read-Host "请输入密钥库密码"
}

$keyPropertiesContent = @"
storePassword=$KeystorePassword
keyPassword=$KeystorePassword
keyAlias=$KeyAlias
storeFile=fitlog-release-key.keystore
"@

Set-Content -Path $keyPropertiesPath -Value $keyPropertiesContent -Encoding UTF8
Write-Host "✅ key.properties文件创建成功!" -ForegroundColor Green

# 备份原始build.gradle
$buildGradlePath = "android/app/build.gradle"
$buildGradleBackup = "android/app/build.gradle.backup"

if (!(Test-Path $buildGradleBackup)) {
    Copy-Item $buildGradlePath $buildGradleBackup
    Write-Host "✅ 已备份原始build.gradle" -ForegroundColor Green
}

# 修改build.gradle添加签名配置
Write-Host "📝 修改build.gradle添加签名配置..." -ForegroundColor Yellow

$buildGradleContent = Get-Content $buildGradlePath -Raw

# 检查是否已经有签名配置
if ($buildGradleContent -notmatch "signingConfigs") {
    # 在android块中添加签名配置
    $signingConfig = @"

    // 加载签名配置
    def keystoreProperties = new Properties()
    def keystorePropertiesFile = rootProject.file('key.properties')
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
    }

    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystorePropertiesFile.exists() ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
"@

    # 在android {之后插入签名配置
    $buildGradleContent = $buildGradleContent -replace "(android\s*\{)", "`$1$signingConfig"
    
    # 修改release buildType使用签名配置
    $buildGradleContent = $buildGradleContent -replace "(release\s*\{[^}]*)", "`$1`n            signingConfig signingConfigs.release"
    
    Set-Content -Path $buildGradlePath -Value $buildGradleContent -Encoding UTF8
    Write-Host "✅ build.gradle签名配置添加成功!" -ForegroundColor Green
} else {
    Write-Host "⚠️  build.gradle已包含签名配置" -ForegroundColor Yellow
}

# 更新版本号
Write-Host "📝 更新版本信息..." -ForegroundColor Yellow
$currentDate = Get-Date -Format "yyyyMMdd"
$versionCode = [int]$currentDate
$versionName = "1.0.$currentDate"

$buildGradleContent = Get-Content $buildGradlePath -Raw
$buildGradleContent = $buildGradleContent -replace "versionCode\s+\d+", "versionCode $versionCode"
$buildGradleContent = $buildGradleContent -replace "versionName\s+`"[^`"]*`"", "versionName `"$versionName`""

Set-Content -Path $buildGradlePath -Value $buildGradleContent -Encoding UTF8
Write-Host "✅ 版本更新为: $versionName (Code: $versionCode)" -ForegroundColor Green

Write-Host "`n🎯 设置完成! 现在可以构建发布版APK了:" -ForegroundColor Green
Write-Host "运行以下命令构建APK:" -ForegroundColor Yellow
Write-Host "  cd android" -ForegroundColor Cyan
Write-Host "  ./gradlew assembleRelease" -ForegroundColor Cyan
Write-Host "`n📱 构建完成后，APK文件位于:" -ForegroundColor Yellow
Write-Host "  android/app/build/outputs/apk/release/app-release.apk" -ForegroundColor Cyan

Write-Host "`n⚠️  重要提醒:" -ForegroundColor Red
Write-Host "  1. 请妥善保管密钥库文件和密码" -ForegroundColor Yellow
Write-Host "  2. 密钥库文件: $keystorePath" -ForegroundColor Yellow
Write-Host "  3. 配置文件: $keyPropertiesPath" -ForegroundColor Yellow
Write-Host "  4. 丢失密钥将无法更新已发布的应用!" -ForegroundColor Yellow