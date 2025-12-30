# ☕ Java JDK 安装指南

## 🎯 快速安装 (推荐)

### 方法1: 使用Chocolatey (最简单)

如果你有Chocolatey包管理器：
```powershell
# 以管理员身份运行PowerShell
choco install openjdk11
```

### 方法2: 手动下载安装

1. **访问 [Adoptium](https://adoptium.net/)**
2. **选择版本**: OpenJDK 11 (LTS) 或 17 (LTS)
3. **选择平台**: Windows x64
4. **下载**: `.msi` 安装包
5. **运行安装程序**，按默认设置安装

## 🔧 设置环境变量

### 自动设置 (安装程序通常会自动设置)
大多数现代安装程序会自动设置环境变量。

### 手动设置 (如果需要)

1. **找到Java安装路径**
   - 通常在: `C:\Program Files\Eclipse Adoptium\jdk-11.x.x-hotspot\`

2. **设置JAVA_HOME**
   - 右键"此电脑" → "属性" → "高级系统设置" → "环境变量"
   - 新建系统变量:
     - 变量名: `JAVA_HOME`
     - 变量值: `C:\Program Files\Eclipse Adoptium\jdk-11.x.x-hotspot`

3. **更新PATH**
   - 编辑系统变量 `Path`
   - 添加: `%JAVA_HOME%\bin`

## ✅ 验证安装

打开新的命令提示符或PowerShell窗口，运行：

```bash
java -version
javac -version
keytool -help
```

应该看到类似输出：
```
openjdk version "11.0.x" 2023-xx-xx
OpenJDK Runtime Environment Temurin-11.0.x+x (build 11.0.x+x)
OpenJDK 64-Bit Server VM Temurin-11.0.x+x (build 11.0.x+x, mixed mode)
```

## 🚀 安装完成后

Java安装完成后，你就可以：

1. **运行设置脚本**:
   ```powershell
   .\setup-release-build.ps1
   ```

2. **构建发布版APK**:
   ```powershell
   .\build-release-apk.ps1
   ```

## 🐛 故障排除

### 问题1: 命令未找到
```
'java' is not recognized as an internal or external command
```
**解决**: 重启命令提示符/PowerShell，或重新设置PATH

### 问题2: JAVA_HOME未设置
```
ERROR: JAVA_HOME is not set
```
**解决**: 按上述步骤设置JAVA_HOME环境变量

### 问题3: 版本不兼容
```
Unsupported class file major version
```
**解决**: 确保安装的是JDK 11或更高版本

## 📞 需要帮助？

如果安装过程中遇到问题：
1. 确保以管理员身份运行安装程序
2. 重启计算机后再试
3. 检查防病毒软件是否阻止了安装

---

**安装完成后，就可以开始构建你的签名APK了！** 🎉