---
name: android-build
description: 把 fitlog 装到安卓手机上验证 —— 选路（静态包 / live reload / 只重装 / dev 数据环境）、装机前预检、失败对照诊断。用户说「装到手机上」「打个包」「真机看看」「live 调界面」「隧道断了」「手机上怎么不更新」时用；gradle 构建报错、adb 装不上、APK 白屏也走这里。
---

# 装到安卓手机上

打包链路已经是脚本了 —— `scripts/deploy-android.ps1`（静态包）和 `scripts/live-android.ps1`
（live reload），里面有三道闸门：环境戳、live 残留、隧道残留。

**别绕过脚本手敲 `npx cap sync` + `gradlew`。** 闸门挡的正是那几种「构建全绿、装上去也能开，
但其实是坏包」的情况 —— dev 环境的包装到手机上看不到自己的记录；带 `server.url` 的包离开
数据线纯白屏、不报错、不回落本地资源。这些从界面上根本看不出原因。

这份文档负责脚本装不下的部分：选哪条路、动手前查什么、报错了是哪个坑。

## 1. 先选路

| 想干什么 | 跑 |
|---|---|
| 要个离开数据线也能用的包（默认） | `npm run android` |
| 调界面，想改代码手机上秒刷 | `npm run android:live`（另一个终端得跑着 `npm run dev`） |
| 拔插过数据线，live 不刷新了 | `npm run android:live -- -TunnelOnly` |
| APK 没变，只想重装一遍 | `npm run android:reinstall` |
| 要造假数据 / 不想碰真实记录 | `npm run android:dev` |

`npm run android` 打的是 **prod 数据环境**的静态包，连 NAS 真实数据。`android:dev` 读写隔离的
`state-dev`，装到手机上看不到自己的训练记录 —— 这是设计如此，不是 bug。

用户的手机常年插着 USB 线，随时可以装机验证。

### 反模式：live 模式下别跑 `npm run android`

正在用 live 调界面时，为了「看一眼新图标 / 新启动图」跑一次 `npm run android`，会**把 live 顶掉**：
装上去的是静态包，代码固化在 APK 里。而隧道还在、dev server 也还活着，于是现象是
**「一切看起来都正常，手机上就是不更新」** —— 极难往这个方向想。踩过一次。

live 包和静态包是从**同一份 `android/app/src/main/res/`** 编出来的，图标、启动图、原生配置照样
在里面。要看图标，`npm run android:live` 就够了。

装静态包前先看预检第 2 条；如果用户正在 live 开发，先问一句再装。

## 2. 动手前的三条预检

adb 不在 PATH 上，用全路径：`$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`

1. **设备在不在** —— `& $adb devices`，要看到一行以 `device` 结尾。
   没有：手机上「开发者选项 → USB 调试」开了吗？插线后弹的「允许调试」点了吗？
   线常年插着，所以「没设备」通常是线松了或授权弹窗没点，不是环境问题。
   （没设备也能出 APK，只是装不上；`deploy-android.ps1` 会把文件路径打出来。）
2. **当前是不是 live 态** —— `& $adb reverse --list`，出现 `tcp:3000` 说明隧道还在，
   多半正在 live 开发。这时要装静态包，先跟用户确认（见上面的反模式）。
3. **`CAP_LIVE_RELOAD` 有没有残留** —— 看 `$env:CAP_LIVE_RELOAD`。
   非空时跑 `npm run android` 会打出带 `server.url` 的包。`deploy-android.ps1` 的闸门会拦住并
   报错，但提前清掉能省一整轮构建：`$env:CAP_LIVE_RELOAD = $null`

## 3. 失败对照表

**`JAVA_HOME is not set`**
这台机器没独立装 JDK，用 Android Studio 自带的 `D:\tools\Android_studio\install\jbr`（JDK 21）。
Android Studio 装在非默认路径 `D:\tools\Android_studio\install`。
两个脚本都会自动探测这个位置，只有手敲 `gradlew` 才会撞到 → 走脚本。

**`Warning: Failed to read or create install properties file`**
这句话**极具误导性**。真实含义是「SDK 组件下载失败」，**不是权限问题** —— SDK 目录完全可写，
别再去查目录权限，这条路已经排除过了。
根因：Gradle 下载 SDK 走 `dl.google.com`，国内不通；项目里配的阿里云 maven 镜像**只对 Maven
依赖生效，管不到 SDK 下载**。本机也没装 `cmdline-tools`，所以连 `sdkmanager` CLI 都没有。
已装的组件只有 `platforms/android-36` + `build-tools/35.0.0`、`36.1.0`，`android/variables.gradle`
正是照着它们钉的，正常构建一个字节都不用下。
所以看到这条错 = **有什么东西在要求下载新组件**。去查是谁动了 SDK 版本，别去修网络。

**`INSTALL_FAILED_UPDATE_INCOMPATIBLE`**
签名不一致：手机上那个包不是这台机器的 debug keystore 打的。
卸载重装是**安全的**：`& $adb uninstall com.myron.fittracker`，然后重跑装机命令。
训练记录在 NAS 上，`src/hooks/useFitlogSync.ts` 启动时自动拉远端，`mergeByIdPreferNewer`
是并集合并、空本地删不掉远端。只丢三个本地设置：主题偏好、振动开关、动效档位。
（换一台机器构建会再次撞到这堵墙，同样处理。）

**装好了，手机上一片白**
- live 包：`npm run dev` 没起，或隧道断了 → `npm run android:live -- -TunnelOnly`
- 静态包：包里混进了 `server.url`（`CAP_LIVE_RELOAD` 残留），离开数据线必白 → 清变量重打

**「手机上就是不更新」**
先确认现在装的是哪种包。live 被静态包顶掉是最常见的原因，见第 1 节的反模式。

## 4. 不要做的事

- **不要动 `targetSdkVersion = 35`。** 它是刻意留的：`compileSdk` 只改可用 API，改 `target`
  才会真的改运行时行为（Android 15+ 强制 edge-to-edge），会打乱本项目的 safe-area 布局。
- **不要为了修构建去下 SDK 组件。** 国内下不动，而且当前版本组合本来就不需要下。
- **不要手敲 `cap sync` + `gradlew` 绕过脚本。** 等于自愿承担坏包风险。
- 根目录的 `build-release.bat` / `build-release-apk.ps1` 是**死的** —— 它们依赖的
  `android/key.properties`、`android/app/fitlog-release-key.keystore`、`setup-release-build.ps1`
  三个前提都不在仓库里，现在跑必然在第一道检查就退出。当前所有装机走 debug 签名，够用。
  真要补活 release 签名路径，是一件独立的事，keystore 密码得用户自己敲。
