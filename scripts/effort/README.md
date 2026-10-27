# 记录开销重算

`docs/competitors/summary.md` 里竞品的开销分数，由这里的日志和脚本算出来。计分规则见 `docs/competitors/effort-standard.md`。

- `runs/*.jsonl` —— 2026-10-26 在真机 / 模拟器上操作竞品的日志，一行一步，由探索用的 adb 驱动脚本 `phone.py` 写出（脚本没收进仓库）。
  `<app>.jsonl` 是第一轮，含 T1 / T3 等场景任务；`*_s2` 是补测，`verify` 是复核，这两类只有探索段。日志里的 Hevy 用户名已替换成「<用户名>」。
- `prep_logs.py` —— 预处理：把 `size` 尺寸覆盖并进点按，再按键位坐标认出 app 自带数字键盘的按键（探索时没有标注）。
- `effort_score.py` —— 计分：逐段报时间、精度、视觉、认知四个维度和总分，外加各类组的平均值。

重算（PowerShell，在仓库根目录跑；输出目录随便选，不进仓库）：

```powershell
python scripts\effort\prep_logs.py $env:TEMP\effort-prep
python scripts\effort\effort_score.py $env:TEMP\effort-prep\hevy.jsonl --task T3
```

改了计分规则或键位以后，6 款都要重跑，再把汇总里的表格一起更新。fitlog 自己的分数不从这里来：它是按代码推算的走法，见 `docs/competitors/effort-fitlog.md`。
