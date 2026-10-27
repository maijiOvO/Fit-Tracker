"""Prepare the competitor action logs (runs/*.jsonl) for effort_score.py.

    python prep_logs.py <out_dir> [<runs_dir>]

1. Fold `size w h` overrides into the preceding tap/long's hit: phone.py's tally honours them, the scorer doesn't.
2. Mark taps on each app's own number keypad as _kind=keypad. The explorers didn't add `note keypad n`, and overlay
   keypads are often missing from the UI tree, so their hit labels name whatever lies underneath.
   Key centres are in screenshot space (540x1200), read off each app's keypad screenshot and the tap clusters;
   a tap within TOL px of a centre in a task phase counts as a key. The key gets the app's measured key size
   (KEY_DP, from the reports) and a label naming its grid cell, so the scorer can aim it like any other target
   and tell a repeated key from a new one (effort-standard.md §4, 2026-10-27).
3. Gym WP types digits on the system number pad (Gboard number layout), logged as `text` with a char count only.
   The digits of each set phase are known from the task, so those `text` rows are replaced by taps on the Gboard
   grid (GBOARD, 89x44 dp keys measured on shots/gymwp/t1_20.png). Letters (search, names) stay `text`.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
RUNS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "runs")
TOL = 13
GRID = {
    "xunji": ([60, 167, 270, 372, 480], [861, 934, 1007, 1080]),
    "lyfta": ([70, 201, 332, 463], [905, 981, 1057, 1133]),
    "hevy": ([77, 215, 354, 477], [869, 945, 1021, 1097]),
    "alpha": ([92, 270, 447], [866, 950, 1034, 1118]),
    "gymtrainer": ([73, 204, 335, 466], [836, 924, 1013, 1057, 1101]),
    "gymwp": ([], []),
}
ID_KEY = re.compile(r"id=(tv_button_|btn_num|btn_backspace|btn_next|btn_dot|btn_00)")
# digit-key size per app (dp), from each report's measured keypad; the special keys differ by a few dp, ignored
KEY_DP = {"xunji": (69, 48), "lyfta": (85, 46), "hevy": (94, 50), "alpha": (117, 53), "gymtrainer": (83, 53)}
# grid columns that hold digits / dot / backspace; the other cells are function keys (next, done, hide, ±, kg/lbs,
# warm-up...). A function key is an ordinary aimed tap of key size, not part of the digit run, so the digits
# before and after it (weight, then reps) stay two value units with their own M (effort-standard.md §4 rule 2).
DIGIT_COLS = {"xunji": {1, 2, 3}, "lyfta": {0, 1, 2}, "hevy": {0, 1, 2}, "alpha": {0, 1, 2}, "gymtrainer": {0, 1, 2}}
FUNC_CELLS = {"alpha": {(3, 2)}}  # Alpha: ✓ sits bottom-right of its 3-column pad
# Gboard number layout in screenshot px (540 wide): columns 1-4-7-, / 2-5-8-0 / 3-6-9-. / - ␣ ⌫ →|
GBOARD_X = {"1": 69, "4": 69, "7": 69, ",": 69, "2": 203, "5": 203, "8": 203, "0": 203,
            "3": 336, "6": 336, "9": 336, ".": 336, "⌫": 470, "→|": 470}
GBOARD_Y = {"1": 878, "2": 878, "3": 878, "4": 949, "5": 949, "6": 949, "⌫": 1020, "7": 1020, "8": 1020, "9": 1020,
            ",": 1092, "0": 1092, ".": 1092, "→|": 1092}
GBOARD_DP = (89, 44)
# Gym WP: digits typed in each set phase, in order (reps first, then weight; from the task values and the logged
# char counts, which match one to one). Set phases without an entry had no typing.
GYMWP_DIGITS = {
    "T1-E1-s1": ["10", "40"], "T1-E1-s2": ["8", "60"], "T1-E1-s4": ["7"],
    "T1-E2-s1": ["10", "22.5"], "T1-E2-s3": ["9"], "T1-E2-s4": ["8"],
    "T1-E3-s1": ["12", "50"], "T1-E3-s2": ["10", "55"], "T1-E3-s4": ["9"],
    "T1-E4-s1": ["12"], "T1-E4-s2": ["10"], "T1-E4-s3": ["8"],
    "T1-E5-s1": ["15", "15"], "T1-E5-s3": ["12", "17.5"],
}


def gboard_taps(phase, s):
    return [{"op": "tap", "phase": phase, "hit": {"label": ch, "cls": "Key", "w_dp": GBOARD_DP[0], "h_dp": GBOARD_DP[1]},
             "xy": [GBOARD_X[ch], GBOARD_Y[ch]], "_kind": "keypad"} for ch in s]


def near(v, centres):
    return any(abs(v - c) <= TOL for c in centres)


os.makedirs(OUT, exist_ok=True)
for app, (cols, rows_y) in GRID.items():
    rows = [json.loads(l) for l in open(os.path.join(RUNS, app + ".jsonl"), encoding="utf-8") if l.strip()]
    last_tap, nkey, nsize = None, 0, 0
    for r in rows:
        op = r.get("op")
        if op in ("tap", "long"):
            last_tap = r
            lab = str((r.get("hit") or {}).get("label", ""))
            if op == "tap" and re.match(r"T\d", r.get("phase") or "") and r.get("xy"):
                x, y = float(r["xy"][0]), float(r["xy"][1])
                if ID_KEY.search(lab) or (cols and near(x, cols) and near(y, rows_y)):
                    nkey += 1
                    ci = min(range(len(cols)), key=lambda i: abs(x - cols[i])) if cols else 0
                    ri = min(range(len(rows_y)), key=lambda i: abs(y - rows_y[i])) if rows_y else 0
                    func = ("btn_next" in lab or ci not in DIGIT_COLS.get(app, {ci})
                            or (ri, ci) in FUNC_CELLS.get(app, set()))
                    if app in KEY_DP:
                        r["hit"] = {"label": lab if ID_KEY.search(lab) else f"key r{ri} c{ci}", "cls": "Key",
                                    "w_dp": KEY_DP[app][0], "h_dp": KEY_DP[app][1]}
                    if not func:
                        r["_kind"] = "keypad"
        elif op in ("swipe", "scroll", "text", "key", "launch"):
            last_tap = None
        elif op == "size" and last_tap is not None:
            h = dict(last_tap.get("hit") or {})
            h["w_dp"], h["h_dp"] = r.get("w_dp"), r.get("h_dp")
            last_tap["hit"] = h
            nsize += 1
    if app == "gymwp":
        # replace each set phase's digit `text` rows with Gboard taps, in logged order
        todo = {ph: list(v) for ph, v in GYMWP_DIGITS.items()}
        out_rows = []
        for r in rows:
            ph = r.get("phase")
            if r.get("op") == "text" and todo.get(ph):
                s = todo[ph].pop(0)
                assert len(s) == int(r.get("chars", 0)), (ph, s, r)
                out_rows.extend(gboard_taps(ph, s))
            else:
                out_rows.append(r)
        assert not any(todo.values()), todo
        rows = out_rows
    with open(os.path.join(OUT, app + ".jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(app, "keypad taps", nkey, "size folded", nsize)
