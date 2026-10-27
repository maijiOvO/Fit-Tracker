"""fitlog's own walkthrough of the standard chest-day task (docs/competitors/effort-standard.md §5), written as a
phone.py-style action log so effort_score.py scores it with the same rules as the competitors.

fitlog has no recorded log: the walk below is the fastest path an experienced user takes through the current UI,
with target sizes measured in a 375 x 812 viewport (1 CSS px = 1 dp). Defaults describe the code as of 2026-10-27
(after the first effort pack: two-tap end, auto-scroll to the next card; the user kept the 36 dp set number, the gym
sheet on start and the long-press entry for "repeat last"). Flags re-create the earlier UI or model candidate
changes, so a change can be scored before it is built.

    python scripts/effort/fitlog_walk.py out.jsonl [flag=value ...]      write the log
    python scripts/effort/fitlog_walk.py --report [flag=value ...]       score it and print the numbers for effort-fitlog.md

Flags (all integers):
    setnum=36      set-number short edge in dp (48 / 56 / 63 are the candidates; 48 was built and rejected 2026-10-27)
    gymsheet=1     0 = no "which gym" sheet on start, the last gym is reused (built and rejected 2026-10-27)
    endconfirm=0   1 = the end-workout confirm dialog (before 2026-10-26); default is the same-button second tap
    repeat=0       1 = a "repeat last" row on the home page instead of the timeline long-press menu (built and rejected 2026-10-27)
    autoscroll=1   0 = the page does not follow the pointer to the next card (one manual scroll per exercise)
    bottom=0       1 = fixed 343x56 bottom button marks the pointer's set done; 2 = 375x96 zone; 3 = 375x192 zone (eyes-free)
    kbdone=0       1 = the keyboard's "done" key on the reps field marks the set done
    autofocus=0    1 = first exercise's empty weight field is focused automatically; 2 = every exercise's (ideal)
    keypad=0       1 = the app's own number pad (no keyboard slide-in wait)
    warm=0         1 = E1-s1 is tagged as a warm-up with one extra 44 dp tap
    halfstep=0     1 = the gym profile offers the cable's add-on plate (+2.5) as a step key (E5-s3 needs no typing)
    scrub=1        first sets are entered by dragging the weight / reps cell (§12.3 scrub, 10 px per detent, a
                   moderate flick reaches the x2 tier); 0 = typed on the system keyboard; 2 = also replace the
                   ± keys on later sets with drags (slower than ± for small changes, kept for comparison)
    old=1          shorthand for endconfirm=1 autoscroll=0 (the UI before the pack, 2026-10-26)
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

    # fitlog's number fields open the system number pad (inputMode decimal / numeric): Gboard number layout, keys
    # 89x44 dp, same grid prep_logs.py uses for Gym WP, placed at the bottom of the 812 dp screen (px space).
    GB_X = {"1": 69, "4": 69, "7": 69, "2": 203, "5": 203, "8": 203, "0": 203, "3": 336, "6": 336, "9": 336, ".": 336, "→|": 470}
    GB_Y = {"1": 820, "2": 820, "3": 820, "4": 891, "5": 891, "6": 891, "7": 962, "8": 962, "9": 962, "0": 1034, ".": 1034, "→|": 1034}

    def gb(self, ch):
        row = {"op": "tap", "phase": self.ph, "hit": {"label": ch, "cls": "Key", "w_dp": 89, "h_dp": 44}, "xy": [self.GB_X[ch], self.GB_Y[ch]]}
        if ch != "→|":
            row["_kind"] = "keypad"  # the next-field key is a plain tap between the two value units
        self.rows.append(row)

    def text(self, s):
        """digits are typed on the system number pad: one aimed tap per key (§4); letters would be `text`"""
        for ch in s:
            self.gb(ch)

    def key(self, k):
        if k == "enter":
            self.gb("→|")  # the pad's 「下一项」 key
        else:
            self.rows.append({"op": "key", "phase": self.ph, "key": k})

    def scrub(self, label, w, h, xy, detents, detent_dp):
        self.rows.append({"op": "scrub", "phase": self.ph, "hit": {"label": label, "cls": "EditText", "w_dp": w, "h_dp": h},
                          "xy": xy, "detents": detents, "detent_dp": detent_dp})

    def shot(self):
        self.rows.append({"op": "shot", "phase": self.ph})

    def popup(self, what):
        self.rows.append({"op": "note", "phase": self.ph, "text": what})


# Layout in dp. ROW_Y: the first set row once the card is scrolled to the top; ± keys show under the selected row.
ROW_Y, ROW_H = 380, 52
X_NUM, X_W, X_R = 36, 116, 206  # set number, weight field, reps field
X_WUP, X_RDN = 140, 230          # +5 kg, −1 rep keys
FAB = (187, 760)

DEFAULTS = dict(setnum=36, gymsheet=1, endconfirm=0, repeat=0, autoscroll=1,
                bottom=0, kbdone=0, autofocus=0, keypad=0, warm=0, halfstep=0, scrub=1)
OLD = dict(endconfirm=1, autoscroll=0)


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

    # §12.3 scrub: the whole cell is the drag zone, 10 px per detent at the default "mid" feel (scrubFeel.ts).
    # Tiers by speed: a moderate flick (>= 0.55 px/ms) doubles the step, so a long change is "flick to the x2
    # tier, then x1 for the remainder". The x4 / x5 tiers need a hard flick and are not assumed.
    DET = 10

    def detents(delta, step, big=2):
        n = int(delta // (step * big))
        return n + int(round((delta - n * step * big) / step))

    def scrub_cell(which, row, n):
        if which == "w":
            L.scrub("重量格", 86, 38, px(X_W, ROW_Y + row * ROW_H), n, DET)
        else:
            L.scrub("次数格", 76, 38, px(X_R, ROW_Y + row * ROW_H), n, DET)

    def change(row, w_label, w_n, w_delta, w_step, r_n):
        """later set: adjust weight (w_n ± taps, or a drag over w_delta at w_step) and reps (r_n taps of −1)"""
        if f["scrub"] == 2:
            if w_n:
                scrub_cell("w", row, detents(w_delta, w_step))
            if r_n:
                scrub_cell("r", row, r_n)
        else:
            if w_n:
                steps(w_label, w_n, row, X_WUP)
            if r_n:
                steps("−1 次", r_n, row, X_RDN)

    def first_set(w, r, bodyweight=False, first_exercise=False, w_detents=0, r_detents=0):
        if f["scrub"]:
            # empty ghost row: drag the weight cell (first detent snaps to the nearest loadable weight, e.g. the
            # bar), then the reps cell from 0, then tap the set number. No keyboard.
            if not bodyweight:
                scrub_cell("w", 0, w_detents)
            scrub_cell("r", 0, r_detents)
            done_tap(0)
            return
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
    # 40 by drag: 1 detent snaps 0 -> bar 20, then 20 kg at 5 per detent (x2 tier: 2); reps 0 -> 10 at x2: 5
    L.phase("T1-E1-s1"); first_set("40", "10", first_exercise=True, w_detents=1 + detents(20, 5), r_detents=detents(10, 1))
    if f["warm"]:
        L.tap("热身", 44, 44, px(300, ROW_Y))
    L.phase("T1-E1-s2"); add_set(1); done_tap(1); change(1, "+5 kg", 4, 20, 5, 2)
    L.phase("T1-E1-s3"); add_set(2); done_tap(2)
    L.phase("T1-E1-s4"); add_set(3); done_tap(3); change(3, "", 0, 0, 0, 1)
    # E2 22.5x10, 22.5x10, 22.5x9, 22.5x8
    L.phase("T1-E2-s1"); next_exercise(); first_set("22.5", "10", w_detents=detents(22.5, 2.5), r_detents=detents(10, 1))  # dumbbell rack steps by 2.5
    L.phase("T1-E2-s2"); add_set(1); done_tap(1)
    L.phase("T1-E2-s3"); add_set(2); done_tap(2); change(2, "", 0, 0, 0, 1)
    L.phase("T1-E2-s4"); add_set(3); done_tap(3); change(3, "", 0, 0, 0, 1)
    # E3 50x12, 55x10, 55x10, 55x9
    L.phase("T1-E3-s1"); next_exercise(); first_set("50", "12", w_detents=detents(50, 5), r_detents=detents(12, 1))  # pin stack steps by 5
    L.phase("T1-E3-s2"); add_set(1); done_tap(1); change(1, "+5 kg", 1, 5, 5, 2)
    L.phase("T1-E3-s3"); add_set(2); done_tap(2)
    L.phase("T1-E3-s4"); add_set(3); done_tap(3); change(3, "", 0, 0, 0, 1)
    # E4 bodyweight x12, x10, +10x8, +10x8
    L.phase("T1-E4-s1"); next_exercise(); first_set(None, "12", bodyweight=True, r_detents=detents(12, 1))
    L.phase("T1-E4-s2"); add_set(1); done_tap(1); change(1, "", 0, 0, 0, 2)
    L.phase("T1-E4-s3"); add_set(2); done_tap(2); change(2, "+5 kg", 2, 10, 1, 2)  # plain number: 1 kg per detent
    L.phase("T1-E4-s4"); add_set(3); done_tap(3)
    # E5 15x15, 15x15, 17.5x12, 17.5x12 (the cable stack steps by 5: 17.5 has to be typed unless halfstep)
    L.phase("T1-E5-s1"); next_exercise(); first_set("15", "15", w_detents=detents(15, 5), r_detents=detents(15, 1))  # cable stack steps by 5
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
