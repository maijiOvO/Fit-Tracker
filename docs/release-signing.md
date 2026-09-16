# 正式签名与发布

> 两个发行变体共用 `applicationId = com.myron.fittracker`，共用一把签名密钥。
> 变体的区别见 [android/app/build.gradle](../android/app/build.gradle) 里的 `productFlavors`。

| 变体 | 谁用 | 数据 | 联网 | web 构建 | 打包命令 |
|---|---|---|---|---|---|
| `personal` | 自己 | 与家里 NAS 同步 | 有 INTERNET 权限 | `npm run build:release`（戳 `prod`） | `npm run apk:personal` |
| `solo` | 发行给别人 | 只在本机 `FitLogDB-solo` | **INTERNET 权限已删除** | `npm run build:solo`（戳 `solo`） | `npm run apk:solo` |

---

## 一次性：生成签名密钥

**这一步必须你自己跑** —— 口令不能经过第三方，也不该写进任何聊天记录。

**在哪跑**：你自己的终端 —— 桌面版 Claude 右侧的 Terminal 标签页，或随便一个 PowerShell 窗口。
不要让 AI 代跑：keytool 会交互式追问口令，而口令不该经过对话记录。

**先切到仓库根目录**（下面的路径是相对它的）：

```powershell
cd "D:\Users\30257\Desktop\personal project\fitlog"
```

然后整条粘进去。**写成一行是刻意的** —— cmd 用 `^` 续行、PowerShell 用反引号，
跨 shell 粘贴时续行符是最容易断的地方：

```powershell
& "D:\tools\Android_studio\install\jbr\bin\keytool.exe" -genkeypair -v -keystore android\fitlog-release.keystore -alias fitlog -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12
```

开头的 `&` 是 PowerShell 的调用运算符，路径带空格或引号时必须有它。

会交互式问你：口令（两次）、姓名/组织/城市/国家。除口令外都可以随便填，
它们只出现在证书里，不影响功能。**口令请存进密码管理器。**

然后手写 `android/key.properties`（已在 .gitignore 里，不会进仓库）：

```
storeFile=fitlog-release.keystore
storePassword=<你刚才设的 store 口令>
keyAlias=fitlog
keyPassword=<你刚才设的 key 口令>
```

`storeFile` 是**相对 `android/` 目录**的路径 —— build.gradle 用
`rootProject.file()` 解析，而这里的 rootProject 是 `android/`。

### 这把密钥丢了或漏了都不可逆

- **漏了**（进过 git、发给别人）：别人能签出冒充你的更新包覆盖安装。
  git 历史里删不干净，只能 filter-repo 重写 + 强推 + 换密钥换包名。
- **丢了**：包名 + 签名指纹绑定，永远无法给已装用户发更新，只能换包名重来，
  老用户得手动卸载重装、且数据不会跟过去（单机版没有服务端兜底）。

⇒ **备份到 git 以外的地方**（密码管理器 / 加密网盘），两头都堵死。

---

## 本项目的签名指纹

```
SHA-256  5e3c1721484272a28c602234164810fa42ce63b15a56acddc4fe32c20925e7b8
DN       CN=Myron Yu, OU=UofT, O=UofT, L=Toronto, ST=Ontario, C=CA
RSA 4096 · 2026-09-15 生成
```

记在这里不是秘密 —— 证书指纹从任何一个 APK 里都能解出来，公开是它的正常用法。
记它的意义是**可核对**：`npm run apk:*` 每次都会打印指纹，
对不上就说明这个包不是用同一把密钥签的（换了机器、换了 keystore、或者 key.properties 被改过）。
而指纹一变，已装用户就无法覆盖更新了。

```sh
# 随时自己核一次
"$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs <apk>
```

## 打包

```
npm run build:solo && npx cap sync android && npm run apk:solo
```

`scripts/build-apk.ps1` 在 gradle 之前有四道闸门，配错了会当场停：

1. `dist/fitlog-build-env.json` 的构建戳必须匹配变体
2. `android/app/src/main/assets/public/` 里同步过去的那一份必须与 dist 一致
   （戳 + 入口 JS 哈希文件名双重比对 —— 「dist 新、assets 旧」是撞过的坑）
3. `android/key.properties` 与它指向的 keystore 必须都在
4. **solo 专有**：解压 APK 逐个扫 `assets/public/*.{js,html,json,css}`，
   命中 NAS 主机名或 `.env.local` 里的真实 API key 就拒绝出包

第 4 道是唯一能证明「这个要发出去的文件真的没带凭据」的检查。
前三道证明的都只是「我构建的东西是干净的」。

---

## 第一次装 personal 包会报签名不一致

手机上现装的是 debug 签名的包，换成正式签名后覆盖安装必然失败：

```
INSTALL_FAILED_UPDATE_INCOMPATIBLE:
  Existing package com.myron.fittracker signatures do not match newer version
```

`adb uninstall com.myron.fittracker` 再装即可。训练记录在 NAS 上，
重装后会自己拉回来；只丢主题 / 振动 / 动效这三个纯本地设置。

---

## 在自己手机上测 solo 包

两个变体共用 applicationId，所以它们会互相覆盖安装、共用数据目录。
但 **solo 用的是独立的 IndexedDB 库名 `FitLogDB-solo`**，所以：

- 装上 solo 包看到的是**空的**（= 真实新用户第一次打开的样子）
- 你的 `FitLogDB` 原封不动，换回 personal 包数据还在
- 桌面图标名字能分辨：personal 显示 `Fit Tracker · NAS`，solo 显示 `Fit Tracker`

**必须在真机上验的一件事**：solo 变体删掉了 INTERNET 权限。
WebView 加载本地 assets 走 Capacitor 的拦截器、不经过网络栈，
理论上不需要该权限 —— 但这件事只有装机跑起来才算数，不能靠推理。
