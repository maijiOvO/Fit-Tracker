# 记录开销重算

`docs/competitors/summary.md` 里竞品的开销分数，由这里的日志和脚本算出来。计分规则见 `docs/competitors/effort-standard.md`。

- `runs/*.jsonl` —— 2026-10-26 在真机 / 模拟器上操作竞品的日志，一行一步，由探索用的 adb 驱动脚本 `phone.py` 写出（脚本没收进仓库）。
  `<app>.jsonl` 是第一轮，含 T1 / T3 等场景任务；`*_s2` 是补测，`verify` 是复核，这两类只有探索段。日志里的 Hevy 用户名已替换成「<用户名>」。
- `prep_logs.py` —— 预处理：把 `size` 尺寸覆盖并进点按，再按键位坐标认出 app 自带数字键盘的按键（探索时没有标注）并写上量到的键尺寸；Gym WP 在系统数字盘上打的数字按 Gboard 键位还原成一下下点按。
- `effort_score.py` —— 计分：逐段报时间、精度、视觉、认知四个维度和总分，外加各类组的平均值。
- `fitlog_walk.py` —— fitlog 自己的走法：按当前界面把标准胸日任务写成同格式的日志（目标尺寸按 375 × 812 视口量），`--report` 直接打印 `effort-fitlog.md` 用的数。
  带开关：`old=1` 还原 2026-10-26 改前的界面，`scrub=0` 把首组按打字算（2026-10-27 前的走法；默认按横拖格子算），其余开关模拟候选改动（底部点击区、键盘完成即做完……），改之前就能算出省多少。

重算（PowerShell，在仓库根目录跑；输出目录随便选，不进仓库）：

```powershell
python scripts\effort\prep_logs.py $env:TEMP\effort-prep
python scripts\effort\effort_score.py $env:TEMP\effort-prep\hevy.jsonl --task T3
```

```powershell
python scripts\effort\fitlog_walk.py --report
python scripts\effort\fitlog_walk.py --report old=1
```

改了计分规则或键位以后，6 款都要重跑，再把汇总里的表格一起更新。fitlog 的界面改了（目标尺寸、步数、弹层）要改 `fitlog_walk.py` 的默认走法再重跑，结果写进 `docs/competitors/effort-fitlog.md`。
