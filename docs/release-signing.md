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

**这台机器的终端是 Windows PowerShell 5.1，不支持 `&&`** —— 用 `;` 串，
或者「成功才继续」写成 `A; if ($?) { B }`：

```powershell
npm run build:solo; if ($?) { npx cap sync android }; if ($?) { npm run apk:solo }
```

`scripts/build-apk.ps1` 在 gradle 之前后共有五道闸门，配错了会当场停：

1. `dist/fitlog-build-env.json` 的构建戳必须匹配变体
2. `android/app/src/main/assets/public/` 里同步过去的那一份必须与 dist 一致
   （戳 + 入口 JS 哈希文件名双重比对 —— 「dist 新、assets 旧」是撞过的坑）
3. `android/key.properties` 与它指向的 keystore 必须都在
4. **solo 专有**：解压 APK 逐个扫 `assets/public/*.{js,html,json,css}`，
   命中 NAS 主机名或 `.env.local` 里的真实 API key 就拒绝出包
5. 产出的 APK 必须**真的被签了**（闸门 3 查的是输入，这道查产物），并打印指纹

第 4 道是唯一能证明「这个要发出去的文件真的没带凭据」的检查。
1–3 证明的都只是「我构建的东西是干净的」。

---

## 发布一个新版本：完整清单

> 五道闸门只管「这次构建对不对」。**它们管不到「传上去的那个文件是不是这次构建的」** ——
> 2026-09-16 实测过一次：GitHub 草稿里挂的 APK 打于前一天，晚于它的一个 commit 没进去，
> 而文件名、大小、sha256 与本地那个文件完全对得上。
> **「草稿 = 本地某个文件」证明不了「本地那个文件 = 当前代码」。** 所以有第 3 步。

### 1. 先定版本号

`android/app/build.gradle` 的 `defaultConfig`：

- **`versionCode` 必须单调递增**，每发一版 +1。安卓拒绝安装 versionCode 更小的包，
  忘了加 = 已装用户永远收不到这次更新。回滚也要发一个 code 更大的包，不能调小。
- `versionName` 是给人看的，按语义化版本改。

### 2. 打包 solo

```powershell
npm run build:solo; if ($?) { npx cap sync android }; if ($?) { npm run apk:solo }
```

五道闸门全绿才算数。产物在
`android\app\build\outputs\apk\solo\release\app-solo-release.apk`。

### 3. 核对「这个 APK 确实是当前代码构建的」

闸门管不到这件事，手动核一次。把 APK 里的 `assets/public/` 与 `dist/` 逐个文件名比对
（`Expand-Archive` 不认 `.apk` 后缀，所以直接读 zip 条目，不解压）：

```powershell
$apk = "android\app\build\outputs\apk\solo\release\app-solo-release.apk"; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $apk)); $inApk = $zip.Entries | Where-Object { $_.FullName -like 'assets/public/*' -and -not $_.FullName.EndsWith('/') } | ForEach-Object { $_.FullName.Substring('assets/public/'.Length) } | Sort-Object; $zip.Dispose(); $distRoot = (Resolve-Path dist).Path; $inDist = Get-ChildItem dist -Recurse -File | ForEach-Object { $_.FullName.Substring($distRoot.Length + 1).Replace('\','/') } | Sort-Object; Compare-Object $inApk $inDist | Format-Table -AutoSize
```

**期望输出正好是这三行，多一行都要查**（`<=` 只在 APK 里，`=>` 只在 dist 里）：

```
InputObject         SideIndicator
-----------         -------------
fonts/.charset-hash =>
cordova.js          <=
cordova_plugins.js  <=
```

前两个是 Capacitor 注入的、dist 里本来就没有；`.charset-hash` 是点文件，
被 build.gradle 里 aapt 的 `ignoreAssetsPattern` 排除掉了。

带哈希的文件名（`index-XXXX.js` 之类）只要出现在输出里，就说明 APK 不是这次 dist 打的，回第 2 步。

### 4. 真机验一遍（改动碰了数据层就必做）

发行版没有服务端兜底，**卸载即失**，所以备份往返是 solo 的生命线。
验它要用 `soloDebug`（release 包 `debuggable=false`，CDP 连不上、驱动不了界面）：

```powershell
npm run build:solo; if ($?) { npx cap sync android }; if ($?) { cd android; .\gradlew.bat :app:assembleSoloDebug --console=plain; cd .. }
```

装它会顶掉正式签名的 personal 包（签名不一致，先 `adb uninstall com.myron.fittracker`）。
判据必须落在 `FitLogDB-solo` 的 **id** 上，不是 toast、也不是条数 ——
导入前要把数据**双向**改脏（删几条 + 加几条），否则「恢复成功」和「什么都没发生」长得一样。
完整做法见知识库 `patterns\每一段都验过不等于整条验过.md`。

### 5. 传到 GitHub Release 草稿

先删旧资产（草稿里已经有同名文件时）：

```powershell
gh release delete-asset v1.0.0 FitTracker-1.0.0.apk --repo maijiOvO/Fit-Tracker --yes
```

再传新的，`#` 后面是发行用的文件名：

```powershell
gh release upload v1.0.0 "android\app\build\outputs\apk\solo\release\app-solo-release.apk#FitTracker-1.0.0.apk" --repo maijiOvO/Fit-Tracker
```

### 6. 发布

在 GitHub 页面上点，或 `gh release edit <tag> --draft=false`。**这一下自己点** ——
发出去就会被人下载，撤不回来。

### 7. 收尾：把工作区和手机恢复成日常状态

上面第 2/4 步把原生工程的 `assets/public` 换成了 solo 的，手机上可能还装着 soloDebug。
两边都要还原：

```powershell
npm run build:release; if ($?) { npx cap sync android }; if ($?) { npm run apk:personal }
```

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" uninstall com.myron.fittracker; & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "android\app\build\outputs\apk\personal\release\app-personal-release.apk"
```

`uninstall` 是必要的：debug 与 release 签名不一致，覆盖装会报
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`。训练记录在 NAS 上会自己同步回来，
只丢主题 / 振动 / 动效三个纯本地设置。

### 已知的产品缺口（发行说明里最好提一句）

分享面板里**没有「保存到文件」**：`Share.share()` 发的是 `ACTION_SEND`（交给另一个 app），
而 Android 的系统文件管理器不接 SEND ——「存到本地」要用 SAF 的 `ACTION_CREATE_DOCUMENT`，
是另一个 intent。所以用户能不能把备份留在本机，取决于他装没装会接 SEND 的文件管理器。
详见知识库 `troubleshooting\Android 分享面板里没有「保存到文件」…md`。

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
