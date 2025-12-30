# 🚀 FitTracker Android发布版构建指南

## 📋 前置要求

### 1. 安装Java JDK
- 下载并安装 [OpenJDK 11](https://adoptium.net/) 或更高版本
- 设置 `JAVA_HOME` 环境变量
- 确保 `java` 和 `keytool` 命令可用

### 2. 验证环境
运行以下命令验证环境：
```bash
java -version
keytool -help
```

## 🔐 方法一：自动化设置（推荐）

### 步骤1: 运行设置脚本
```powershell
# PowerShell (推荐)
.\setup-release-build.ps1

# 或者使用批处理
setup-release.bat
```

这个脚本会：
- ✅ 检查Java环境
- 🔐 生成签名密钥库
- 📝 创建签名配置文件
- 🔧 修改build.gradle配置
- 📊 更新版本号

### 步骤2: 构建APK
```powershell
# PowerShell
.\build-release-apk.ps1

# 或者使用批处理
.\build-release.bat
```

## 🛠️ 方法二：手动设置

### 步骤1: 生成签名密钥
```bash
keytool -genkey -v -keystore android/app/fitlog-release-key.keystore -alias fitlog-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

输入以下信息：
- 密钥库密码（请记住！）
- 姓名：FitTracker
- 组织单位：MyronDev
- 组织：MyronDev
- 城市：Beijing
- 省份：Beijing
- 国家代码：CN

### 步骤2: 创建签名配置文件
创建 `android/key.properties`：
```properties
storePassword=你的密钥库密码
keyPassword=你的密钥密码
keyAlias=fitlog-key-alias
storeFile=fitlog-release-key.keystore
```

### 步骤3: 修改build.gradle
编辑 `android/app/build.gradle`，在 `android {` 块中添加：

```gradle
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
```

在 `buildTypes` 的 `release` 块中添加：
```gradle
buildTypes {
    release {
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        signingConfig signingConfigs.release  // 添加这行
    }
}
```

### 步骤4: 更新版本号
在 `android/app/build.gradle` 中更新：
```gradle
defaultConfig {
    // ...
    versionCode 20241230  // 使用日期格式
    versionName "1.0.20241230"
    // ...
}
```

### 步骤5: 构建APK
```bash
cd android
./gradlew clean
./gradlew assembleRelease
```

## 📱 输出文件

构建成功后，APK文件位于：
```
android/app/build/outputs/apk/release/app-release.apk
```

## 🔍 验证APK

### 1. 检查签名
```bash
jarsigner -verify -verbose -certs android/app/build/outputs/apk/release/app-release.apk
```

### 2. 查看APK信息
```bash
aapt dump badging android/app/build/outputs/apk/release/app-release.apk
```

## 📦 发布准备

### 1. 测试APK
- 在真实Android设备上安装测试
- 验证所有功能正常工作
- 确认单位转换修复生效

### 2. 准备发布材料
- 应用图标 (512x512 PNG)
- 应用截图 (至少2张)
- 应用描述
- 隐私政策链接
- 版本更新说明

### 3. 发布渠道选择

**Google Play Store:**
- 需要开发者账号 ($25一次性费用)
- 审核时间：1-3天
- 全球分发

**其他渠道:**
- 华为应用市场
- 小米应用商店
- OPPO软件商店
- vivo应用商店
- 应用宝（腾讯）

## ⚠️ 重要提醒

### 🔐 密钥安全
- **绝对不要丢失密钥库文件和密码！**
- 建议备份到安全的地方
- 丢失密钥将无法更新已发布的应用

### 📁 文件管理
需要保护的文件：
- `android/app/fitlog-release-key.keystore` (密钥库)
- `android/key.properties` (配置文件)

不要提交到Git的文件：
- `*.keystore`
- `key.properties`

### 🔄 版本管理
每次发布新版本时：
1. 增加 `versionCode`
2. 更新 `versionName`
3. 更新版本说明

## 🐛 故障排除

### 常见问题

**1. JAVA_HOME未设置**
```
ERROR: JAVA_HOME is not set
```
解决：设置JAVA_HOME环境变量

**2. 密钥库密码错误**
```
keystore password was incorrect
```
解决：检查key.properties中的密码

**3. 构建失败**
```
Execution failed for task ':app:packageRelease'
```
解决：检查签名配置是否正确

**4. APK未签名**
```
APK is not signed
```
解决：确保signingConfig配置正确

### 获取帮助
如果遇到问题，请检查：
1. Java版本是否正确
2. 签名配置是否完整
3. 密钥库文件是否存在
4. 构建日志中的错误信息

## 🎉 成功标志

当你看到以下信息时，表示构建成功：
```
BUILD SUCCESSFUL in 2m 30s
```

APK文件大小通常在 10-50 MB 之间。

---

**祝你发布成功！** 🚀