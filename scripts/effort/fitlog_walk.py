"""fitlog's own walkthrough of the standard chest-day task (docs/competitors/effort-standard.md §5), written as a
phone.py-style action log so effort_score.py scores it with the same rules as the competitors.

fitlog has no recorded log: the walk below is the fastest path an experienced user takes through the current UI,
with target sizes measured in a 375 x 812 viewport (1 CSS px = 1 dp). Defaults describe the code as of 2026-10-26
(after the effort pack: 48 dp set numbers, no gym sheet on start, two-tap end, "repeat last" on the home page,
auto-scroll to the next card). Flags re-create the earlier UI or model candidate changes, so a change can be
scored before it is built.

    python scripts/effort/fitlog_walk.py out.jsonl [flag=value ...]      write the log
    python scripts/effort/fitlog_walk.py --report [flag=value ...]       score it and print the numbers for effort-fitlog.md

Flags (all integers):
    setnum=48      set-number short edge in dp (36 before 2026-10-26)
    gymsheet=0     1 = the "which gym" sheet pops on every start (before 2026-10-26)
    endconfirm=0   1 = the end-workout confirm dialog (before 2026-10-26); default is the same-button second tap
    repeat=1       0 = no "repeat last" row on the home page: T3 starts from the timeline long-press menu
    autoscroll=1   0 = the page does not follow the pointer to the next card (one manual scroll per exercise)
    bottom=0       1 = fixed 343x56 bottom button marks the pointer's set done; 2 = 375x96 zone; 3 = 375x192 zone (eyes-free)
    kbdone=0       1 = the keyboard's "done" key on the reps field marks the set done
    autofocus=0    1 = first exercise's empty weight field is focused automatically; 2 = every exercise's (ideal)
    keypad=0       1 = the app's own number pad (no keyboard slide-in wait)
    warm=0         1 = E1-s1 is tagged as a warm-up with one extra 44 dp tap
    halfstep=0     1 = the gym profile offers the cable's add-on plate (+2.5) as a step key (E5-s3 needs no typing)
    old=1          shorthand for setnum=36 gymsheet=1 endconfirm=1 repeat=0 autoscroll=0 (the UI before the pack)
"""
import contextlib
import io
import json
import os
import sys

SCALE = 540 / 384  # dp -> phone.py screenshot px


def px(x_dp, y_dp):
    return [round(x_dp * SCALE), round(y_dp * SCALE)]


class Log:
    def __init__(self):
        self.rows = []
        self.ph = None

    def phase(self, ph):
        self.ph = ph

    def tap(self, label, w, h, xy, cls="Button"):
        self.rows.append({"op": "tap", "phase": self.ph, "hit": {"label": label, "cls": cls, "w_dp": w, "h_dp": h}, "xy": xy})

    def long(self, label, w, h, xy):
        self.rows.append({"op": "long", "phase": self.ph, "hit": {"label": label, "cls": "View", "w_dp": w, "h_dp": h}, "xy": xy})

    def scroll(self):
        self.rows.append({"op": "scroll", "phase": self.ph})

    def swipe(self):
        self.rows.append({"op": "swipe", "phase": self.ph})

    def text(self, s):
        self.rows.append({"op": "text", "phase": self.ph, "chars": len(s)})

    def key(self, k):
        self.rows.append({"op": "key", "phase": self.ph, "key": k})

    def shot(self):
        self.rows.append({"op": "shot", "phase": self.ph})

    def popup(self, what):
        self.rows.append({"op": "note", "phase": self.ph, "text": what})


# Layout in dp. ROW_Y: the first set row once the card is scrolled to the top; ± keys show under the selected row.
ROW_Y, ROW_H = 380, 52
X_NUM, X_W, X_R = 36, 116, 206  # set number, weight field, reps field
X_WUP, X_RDN = 140, 230          # +5 kg, −1 rep keys
FAB = (187, 760)

DEFAULTS = dict(setnum=48, gymsheet=0, endconfirm=0, repeat=1, autoscroll=1,
                bottom=0, kbdone=0, autofocus=0, keypad=0, warm=0, halfstep=0)
OLD = dict(setnum=36, gymsheet=1, endconfirm=1, repeat=0, autoscroll=0)


def walk(flags):
    f = dict(DEFAULTS)
    if flags.get("old"):
        f.update(OLD)
    f.update({k: v for k, v in flags.items() if k != "old"})
    L = Log()
    edit_cls = "View" if f["keypad"] else "EditText"

    def done_tap(row):
        """mark the set under the pointer done"""
        if f["bottom"] == 1:
            L.tap("记下一组", 343, 56, px(187, 760))
        elif f["bottom"] == 2:
            L.tap("记下一组(区)", 375, 96, px(187, 812 - 48))
        elif f["bottom"] == 3:
            L.tap("记下一组(半屏区)", 375, 192, px(187, 812 - 96))
        else:
            L.tap(f"组号{row + 1}", f["setnum"], f["setnum"], px(X_NUM, ROW_Y + row * ROW_H))

    def add_set(k):
        # 「添加组」 sits right under the k rows the card has at that moment
        L.tap("添加组", 318, 44, px(187, ROW_Y + k * ROW_H + 10))

    def type_set(row, w, r, bodyweight=False, focused=False):
        if not bodyweight:
            if not focused:
                L.tap("重量格", 86, 38, px(X_W, ROW_Y + row * ROW_H), cls=edit_cls)
            L.text(w)
            L.key("enter")  # 「下一项」 to reps
        else:
            L.tap("次数格", 76, 38, px(X_R, ROW_Y + row * ROW_H), cls=edit_cls)
        L.text(r)
        if f["kbdone"]:
            L.key("enter")  # keyboard 「完成」 marks the set done
        else:
            done_tap(row)

    def steps(label, n, row, x):
        for _ in range(n):
            L.tap(label, 56, 40, px(x, ROW_Y + (row + 1) * ROW_H))

    def first_set(w, r, bodyweight=False, first_exercise=False):
        focused = bool(f["autofocus"]) and not bodyweight and (first_exercise or f["autofocus"] == 2)
        type_set(0, w, r, bodyweight, focused)

    def next_exercise():
        if not f["autoscroll"]:
            L.scroll()

    def finish(ph):
        L.phase(ph)
        L.tap("结束训练", 146, 44, px(300, 60))
        if f["endconfirm"]:
            L.popup("弹窗：确认结束")
            L.tap("结束训练（确认）", 179, 51, px(280, 420))
        else:
            L.tap("结束训练", 146, 44, px(300, 60))  # same target: the second tap confirms, no new aim

    # ---------------- T1: first time, blank workout ----------------
    L.phase("T1-start")
    L.tap("开始训练", 56, 56, px(*FAB))
    if f["gymsheet"]:
        L.popup("弹层：这场在哪个馆练")
        L.tap("馆名", 311, 48, px(187, 600))
    L.shot()  # the workout page
    L.tap("胸", 94, 112, px(70, 330))
    L.popup("弹层：添加动作")
    for i, nm in enumerate(["杠铃卧推", "上斜哑铃卧推", "器械推胸"], 1):
        L.phase(f"T1-E{i}-add")
        L.tap(nm, 112, 59, px(100, 500))
    L.phase("T1-E4-add")
    L.swipe()
    L.tap("双杠臂屈伸", 112, 59, px(100, 500))
    L.phase("T1-E5-add")
    L.tap("绳索夹胸", 112, 59, px(100, 500))
    L.tap("完成", 343, 48, px(187, 770))

    # E1 40x10 (warm-up), 60x8, 60x8, 60x7
    L.phase("T1-E1-s1"); first_set("40", "10", first_exercise=True)
    if f["warm"]:
        L.tap("热身", 44, 44, px(300, ROW_Y))
    L.phase("T1-E1-s2"); add_set(1); done_tap(1); steps("+5 kg", 4, 1, X_WUP); steps("−1 次", 2, 1, X_RDN)
    L.phase("T1-E1-s3"); add_set(2); done_tap(2)
    L.phase("T1-E1-s4"); add_set(3); done_tap(3); steps("−1 次", 1, 3, X_RDN)
    # E2 22.5x10, 22.5x10, 22.5x9, 22.5x8
    L.phase("T1-E2-s1"); next_exercise(); first_set("22.5", "10")
    L.phase("T1-E2-s2"); add_set(1); done_tap(1)
    L.phase("T1-E2-s3"); add_set(2); done_tap(2); steps("−1 次", 1, 2, X_RDN)
    L.phase("T1-E2-s4"); add_set(3); done_tap(3); steps("−1 次", 1, 3, X_RDN)
    # E3 50x12, 55x10, 55x10, 55x9
    L.phase("T1-E3-s1"); next_exercise(); first_set("50", "12")
    L.phase("T1-E3-s2"); add_set(1); done_tap(1); steps("+5 kg", 1, 1, X_WUP); steps("−1 次", 2, 1, X_RDN)
    L.phase("T1-E3-s3"); add_set(2); done_tap(2)
    L.phase("T1-E3-s4"); add_set(3); done_tap(3); steps("−1 次", 1, 3, X_RDN)
    # E4 bodyweight x12, x10, +10x8, +10x8
    L.phase("T1-E4-s1"); next_exercise(); first_set(None, "12", bodyweight=True)
    L.phase("T1-E4-s2"); add_set(1); done_tap(1); steps("−1 次", 2, 1, X_RDN)
    L.phase("T1-E4-s3"); add_set(2); done_tap(2); steps("+5 kg", 2, 2, X_WUP); steps("−1 次", 2, 2, X_RDN)
    L.phase("T1-E4-s4"); add_set(3); done_tap(3)
    # E5 15x15, 15x15, 17.5x12, 17.5x12 (the cable stack steps by 5: 17.5 has to be typed unless halfstep)
    L.phase("T1-E5-s1"); next_exercise(); first_set("15", "15")
    L.phase("T1-E5-s2"); add_set(1); done_tap(1)
    L.phase("T1-E5-s3"); add_set(2)
    if f["halfstep"]:
        done_tap(2); steps("+2.5 kg", 1, 2, X_WUP); steps("−1 次", 3, 2, X_RDN)
    else:
        type_set(2, "17.5", "12")
    L.phase("T1-E5-s4"); add_set(3); done_tap(3)
    finish("T1-finish")

    # ---------------- T3: next day, same workout ----------------
    L.phase("T3-start")
    if f["repeat"]:
        L.tap("上次 · 再练一次", 343, 56, px(187, 240))
    else:
        L.long("时间线上的一场", 343, 85, px(187, 250))
        L.popup("弹层：长按菜单")
        L.tap("复制为今天的训练", 343, 44, px(187, 350))
    if f["gymsheet"]:
        L.popup("弹层：这场在哪个馆练")
        L.tap("馆名", 311, 48, px(187, 600))
    for e in range(1, 6):
        for s in range(4):
            L.phase(f"T3-E{e}-s{s + 1}")
            if s == 0 and e > 1:
                next_exercise()
            done_tap(s)
    finish("T3-finish")
    return L.rows


def write(path, flags):
    with open(path, "w", encoding="utf-8") as fp:
        for r in walk(flags):
            fp.write(json.dumps(r, ensure_ascii=False) + "\n")


def report(flags):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import effort_score

    path = os.path.join(os.environ.get("TEMP", "."), "fitlog_walk.jsonl")
    write(path, flags)
    with contextlib.redirect_stdout(io.StringIO()):
        out = effort_score.report(path, None, True)
    t = out["totals"]
    print("flags:", {**DEFAULTS, **flags})
    print(f"{'':<4}{'score':>7}{'sec':>7}{'bits':>7}{'visual':>7}{'M':>4}")
    for k in ("T1", "T3"):
        d = t[k]
        print(f"{k:<4}{d['score']:>7.1f}{d['sec']:>7.1f}{d['bits']:>7.1f}{d['visual']:>7.1f}{d['Ms']:>4.0f}")
    kinds = ["首组", "热身", "同上组", "只改次数", "改重量", "自重", "负重"]
    print("kind      " + "".join(f"{k:>8}" for k in kinds))
    for task in ("T1", "T3"):
        for x, lab in (("score", "分"), ("sec", "秒"), ("bits", "bit"), ("Ms", "M")):
            print(f"{task} {lab:<6}" + "".join(f"{out['kinds'][task][k][x]:>8.2f}" for k in kinds))
    print("segments (sec / bits / M / score):")
    for ph, d in out["phases"].items():
        if ph.endswith(("start", "finish", "add")) or ph in ("T1-E1-s1", "T1-E1-s2", "T1-E1-s3", "T1-E1-s4", "T1-E5-s3", "T3-E1-s1", "T3-E2-s1"):
            print(f"  {ph:<12}{d['sec']:>6.2f}{d['bits']:>7.2f}{d['Ms']:>3.0f}{d['score']:>6.2f}")


if __name__ == "__main__":
    args = sys.argv[1:]
    flags = {k: int(v) for k, v in (a.split("=") for a in args if "=" in a)}
    if "--report" in args:
        report(flags)
    else:
        write(args[0], flags)
