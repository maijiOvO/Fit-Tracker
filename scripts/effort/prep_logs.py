"""Prepare the competitor action logs (runs/*.jsonl) for effort_score.py.

    python prep_logs.py <out_dir> [<runs_dir>]

1. Fold `size w h` overrides into the preceding tap/long's hit: phone.py's tally honours them, the scorer doesn't.
2. Mark taps on each app's own number keypad as _kind=keypad. The explorers didn't add `note keypad n`, and overlay
   keypads are often missing from the UI tree, so their hit labels name whatever lies underneath.
   Key centres are in screenshot space (540x1200), read off each app's keypad screenshot and the tap clusters;
   a tap within TOL px of a centre in a task phase counts as a key. Gym WP uses the system keyboard (`text` ops).
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
                    r["_kind"] = "keypad"
                    nkey += 1
        elif op in ("swipe", "scroll", "text", "key", "launch"):
            last_tap = None
        elif op == "size" and last_tap is not None:
            h = dict(last_tap.get("hit") or {})
            h["w_dp"], h["h_dp"] = r.get("w_dp"), r.get("h_dp")
            last_tap["hit"] = h
            nsize += 1
    with open(os.path.join(OUT, app + ".jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(app, "keypad taps", nkey, "size folded", nsize)
