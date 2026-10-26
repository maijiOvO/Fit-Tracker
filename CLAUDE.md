# CLAUDE.md

## 编码知识库：先查，再动手

`G:\我的云端硬盘\DevNotes` 是跨项目的编码知识库（Obsidian vault）。fitlog 的历史坑已经挖过一遍并写进去了，**动手前先查**：

```sh
grep -ril "<关键词>" G:\我的云端硬盘\DevNotes
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

`_memory/fitlog/` 里另有 14 篇项目级记忆（toolchain-traps、phone-webview-cdp 等），会自动加载。

## 文档与测试

文档索引在 `docs/README.md`。测试分三层：`npm run check`（纯规则，秒级）、`npm run e2e`（关键路径，约半分钟）、
`docs/manual-check.md`（真机手感 / 观感）。给我的命令按全局规则写 PowerShell 5.1。

## 写回知识库

满足任一条就该写：诊断超过两轮往返才定案；做了有取舍的决定；第三次撞到同形态的坑；**我判断错了被用户纠正**。

时机是问题解决的当下，用户也可以敲 `/dev-note`。

根因和判据我写全，不留空问用户。写不出来就标 `> [!todo] 结论存疑` 并说清缺什么。

格式为 grep 优化：**结论前置，错误原文一字不改地贴。**

## 写代码的约定（2026-10-26 瘦身后定，每条都对应那次删掉的一类东西）

- **只导出有人引用的**：组件只留具名导出；context 的 value、hook 的返回值和参数只放已有消费者的，setter 不直接暴露。
- **不预留参数 / prop**：没有第二个调用方之前不加可选参数，加了就得当场有一处传非默认值。
- **先 grep 再手写**：日期走 `src/utils/dateUtils`，换算只用 `KG_TO_LBS` / `KG_PER_LB`，补零用 `format.pad2`；`src/utils`、`services` 里有的不写第二份。
- **防御只写在数据进来的那一层**（IndexedDB / 远端 / 文件 / CSV）；门面（`storage`、`haptic`、`db`）内部不抛，调用方不再包 try/catch，类型非空的值不写 `?.`。
- **纯转发不写**：函数体只有 `return other(...)` 就直接用 `other`；删一个读取处时顺手 grep 它的传入处，两头一起删。
- **注释跟代码一起改**：改一段代码先读它头上的注释；不用 `void x` 压 `noUnusedLocals`；仓库没有 eslint，别写 `eslint-disable`。
- **删带中文的代码或注释前核字体子集**：`node scripts/diff/charset-diff.mjs <main> <分支>`，A 有 B 没有的字必须为空（build-fonts 按源码全文含注释收集字符）。
- **删任何防御前先查 DevNotes**：`sw.js`、`fontGuard`、`appEnv`、同步、备份里的判断多半在防记过的坑，删了就在原处写一行为什么现在不需要。
- **纯逻辑先有最下层用例，大改后跑对照**：取整 / 合并 / 排序 / 纪录判定进 `scripts/*-check.mjs` 并先见过红；多文件重构用 `scripts/diff/`（见其 README）比主仓与分支。
