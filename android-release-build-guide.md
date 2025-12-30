# Android发布版APK构建指南

## 前置要求

### 1. 安装Java Development Kit (JDK)
你需要安装JDK 11或更高版本：

**选项A: 下载Oracle JDK**
- 访问: https://www.oracle.com/java/technologies/downloads/
- 下载JDK 11或17
- 安装后设置环境变量

**选项B: 下载OpenJDK (推荐)**
- 访问: https://adoptium.net/
- 下载JDK 11或17
- 安装后设置环境变量

### 2. 设置环境变量
安装Java后，需要设置JAVA_HOME环境变量：

1. 打开"系统属性" -> "高级" -> "环境变量"
2. 新建系统变量：
   - 变量名: `JAVA_HOME`
   - 变量值: Java安装路径 (例如: `C:\Program Files\Java\jdk-11.0.x`)
3. 编辑PATH变量，添加: `%JAVA_HOME%\bin`

## 构建签名APK的步骤

### 步骤1: 生成签名密钥

在项目根目录运行以下命令：

```bash
keytool -genkey -v -keystore android/app/fitlog-release-key.keystore -alias fitlog-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

系统会提示你输入以下信息：
- 密钥库密码 (请记住这个密码！)
- 姓名
- 组织单位
- 组织
- 城市
- 省份
- 国家代码 (例如: CN)

### 步骤2: 配置签名信息

创建或编辑 `android/key.properties` 文件：

```properties
storePassword=你的密钥库密码
keyPassword=你的密钥密码
keyAlias=fitlog-key-alias
storeFile=fitlog-release-key.keystore
```

### 步骤3: 修改build.gradle配置

编辑 `android/app/build.gradle` 文件，添加签名配置。

### 步骤4: 构建发布版APK

```bash
cd android
./gradlew assembleRelease
```

构建完成后，APK文件位于：
`android/app/build/outputs/apk/release/app-release.apk`

## 自动化脚本

我将为你创建自动化脚本来简化这个过程。

## 注意事项

1. **保护好你的签名密钥**: 
   - 密钥库文件 (.keystore) 和密码必须安全保存
   - 丢失密钥将无法更新已发布的应用

2. **版本管理**:
   - 每次发布新版本时，需要增加版本号
   - 版本号在 `android/app/build.gradle` 中配置

3. **测试**:
   - 在发布前，务必在真实设备上测试APK
   - 确认所有功能正常工作

## 故障排除

### 常见问题:

1. **JAVA_HOME未设置**: 确保正确安装Java并设置环境变量
2. **权限问题**: 在Windows上可能需要以管理员身份运行命令
3. **路径问题**: 确保所有路径使用正确的分隔符

### 验证Java安装:

```bash
java -version
javac -version
```

应该显示Java版本信息。