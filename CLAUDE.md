# CLAUDE.md

## 编码知识库：先查，再动手

`D:\DevNotes` 是跨项目的编码知识库（Obsidian vault）。fitlog 的历史坑已经挖过一遍并写进去了，**动手前先查**：

```sh
grep -ril "<关键词>" D:\DevNotes
```

本项目直接相关的入口：

- `stack\fitlog 项目速写.md` —— 是什么、技术栈、部署形态。**先读这篇**
- `troubleshooting\Service Worker 缓存 index.html 导致每次重新打包必白屏.md` —— 「换个图标就白屏」的真因
- `troubleshooting\Service Worker 冻结不带哈希的字体文件导致三层探针全是假绿.md`
- `troubleshooting\Gradle 报 install properties file 其实是 SDK 下载失败.md` —— 不是权限问题
- `stack\Capacitor 项目钉 build-tools 版本必须写在根 subprojects.md`
- `troubleshooting\npm run android 会静默把 Capacitor live-reload 顶掉.md`
- `decisions\开发与生产数据隔离改成服务端强制.md` + `patterns\约定式隔离的四个洞.md`
- `patterns\本地优先同步与后端迁移的四道必答题.md`

**这个项目「假的成功信号」类的坑特别多（挖出 9 条）。** 看到「构建通过 / e2e 全绿 / fetch 200 / 已缓存」时，先读 `patterns\假的成功信号.md` 再下结论。

`_memory/fitlog/` 里另有 9 篇项目级记忆（toolchain-traps、phone-webview-cdp 等），会自动加载。

## 写回知识库

满足任一条就该写：诊断超过两轮往返才定案；做了有取舍的决定；第三次撞到同形态的坑；**我判断错了被用户纠正**。

时机是问题解决的当下，用户也可以敲 `/dev-note`。

根因和判据我写全，不留空问用户。写不出来就标 `> [!todo] 结论存疑` 并说清缺什么。

格式为 grep 优化：**结论前置，错误原文一字不改地贴。**
