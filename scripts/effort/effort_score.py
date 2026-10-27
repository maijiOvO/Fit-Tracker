"""Score a phone.py action log (logs/<app>.jsonl) with the effort standard
(docs/competitors/effort-standard.md in the fitlog repo). Output is seconds.

    python effort_score.py <log.jsonl> [--task T1] [--json]

Operator values and the open (待定) parameters live in PARAMS; change them there,
never inline, so every app is scored with the same numbers.
"""
import json
import math
import re
import sys
from collections import defaultdict

PARAMS = {
    # literature operators (seconds)
    "P": 0.34,   # move finger to target            Nyström 2018
    "T": 0.25,   # tap, excluding the move          Nyström 2018
    "D": 0.44,   # drag                             Nyström 2018
    "F": 0.42,   # flick / scroll / back gesture    Nyström 2018
    "K": 0.33,   # one key on any keyboard          Palin et al. 2019 (36.2 WPM)
    "M": 1.35,   # mental act                       Card et al. 1980; Holleis 2007
    "S_micro": 0.14,  # glance keyboard <-> field    Holleis 2007
    # set by the user 2026-10-26 (no literature value)
    "R_kb": 0.30,     # system keyboard slides in; measure only if an app is visibly slower than 0.5 s
    "R_popup": 0.30,  # dialog / sheet appears
    "R_long": 0.50,   # long-press threshold when the app's own is unknown; no extra M
    "reach_penalty": True,  # targets in the top quarter: short edge x REACH_SCALE
    # no distraction multiplier (Holleis X): user decided 2026-10-26, no gym value in the literature
}

# hit rate by the target's short edge, linear between measured points (MDPI ~2025: mm -> first-try hit rate)
HIT_CURVE = [(2, 0.16), (6, 0.87), (9, 0.95), (10, 1.00)]
MM_PER_DP = 25.4 / 160
REACH_SCALE = 0.75  # top-quarter targets: short edge counted at 3/4 (about one size class down)
SCREEN_H = 1200  # phone.py screenshot space height (540 wide, 384x853 dp)
CANDIDATE_DP = 40  # IME candidate bar entry, for the pinyin rule

# effort dimensions (effort-standard.md §7). Weights: NASA-TLX pairwise comparison by the user, 2026-10-26
# (precision 2.5, cognitive 2.5, visual 1, time 0 wins out of 6). REF = one "standard set": one M plus one
# aimed tap on a 48 dp target 30 mm away; every dimension is divided by it, so a score of 1.0 = one standard set.
WEIGHTS = {"time": 0 / 6, "precision": 2.5 / 6, "visual": 1 / 6, "cognitive": 2.5 / 6}
DEFAULT_D_MM = 30.0          # thumb travel when the previous touch point is unknown (first aim of a segment)
KEY_BITS = math.log2(3)      # one key: ~2 key widths of travel onto a key-wide target
FUZZY_DP = 192               # a target at least half the screen wide can be hit without looking
PX_TO_MM = 384 / 540 * MM_PER_DP  # phone.py screenshot px -> mm


def fitts_bits(d_mm, w_mm):
    return math.log2(d_mm / w_mm + 1)


REF = {"time": 1.35 + 0.65, "precision": fitts_bits(DEFAULT_D_MM, 48 * MM_PER_DP), "visual": 1.35 + 0.65, "cognitive": 1}

KEYPAD = re.compile(r"^([0-9.]|删除|退格|del|⌫)$", re.I)
STEPPER = re.compile(r"^([+\-−–]\s?[\d.]+|[+\-−–])(\s|$)|^(重量|次数|Weight|Reps)\s?[加减+\-−]")
POPUP_NOTE = re.compile(r"弹窗|弹层|popup|dialog|modal|sheet", re.I)
DRAG_NOTE = re.compile(r"精确拖动|drag", re.I)
PINYIN_NOTE = re.compile(r"^(pinyin|拼音)", re.I)

# set-kind tags of the chest-day task (effort-standard.md §5)
KINDS = {
    "E1-s1": ["首组", "热身"], "E1-s2": ["改重量"], "E1-s3": ["同上组"], "E1-s4": ["只改次数"],
    "E2-s1": ["首组"], "E2-s2": ["同上组"], "E2-s3": ["只改次数"], "E2-s4": ["只改次数"],
    "E3-s1": ["首组"], "E3-s2": ["改重量"], "E3-s3": ["同上组"], "E3-s4": ["只改次数"],
    "E4-s1": ["首组", "自重"], "E4-s2": ["只改次数", "自重"], "E4-s3": ["改重量", "负重"], "E4-s4": ["同上组", "负重"],
    "E5-s1": ["首组"], "E5-s2": ["同上组"], "E5-s3": ["改重量"], "E5-s4": ["同上组"],
}


def hit_rate(dp):
    mm = dp * MM_PER_DP
    if mm <= HIT_CURVE[0][0]:
        return HIT_CURVE[0][1]
    for (m0, p0), (m1, p1) in zip(HIT_CURVE, HIT_CURVE[1:]):
        if mm <= m1:
            return p0 + (p1 - p0) * (mm - m0) / (m1 - m0)
    return HIT_CURVE[-1][1]


def tier(hit, xy):
    w, h = (hit or {}).get("w_dp"), (hit or {}).get("h_dp")
    if not w or not h:
        return hit_rate(48), 48
    edge = min(w, h)
    if PARAMS["reach_penalty"] and xy and float(xy[1]) < SCREEN_H / 4:
        edge *= REACH_SCALE
    return hit_rate(edge), edge


def score(path, task=None):
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    # drop voided actions: a "void n" entry voids the last n actions not voided yet (same rule as phone.py tally)
    acts = ("tap", "long", "swipe", "scroll", "text", "key", "scrub", "launch")
    keep = [True] * len(rows)
    for i, r in enumerate(rows):
        if r.get("op") == "void":
            prev = [j for j in range(i) if rows[j].get("op") in acts and keep[j]]
            for j in prev[-int(r.get("n", 1)):]:
                keep[j] = False
    # "note keypad n": the last n taps were keys of the app's own keypad. Overlay keypads are often
    # missing from the UI tree, so their hit labels name whatever lies underneath.
    for i, r in enumerate(rows):
        m = r.get("op") == "note" and re.match(r"^keypad\s+(\d+)", r.get("text", ""))
        if m:
            taps = [j for j in range(i) if rows[j].get("op") == "tap" and keep[j]]
            for j in taps[-int(m.group(1)):]:
                rows[j]["_kind"] = "keypad"
    rows = [r for r, k in zip(rows, keep) if k]

    P = PARAMS
    phases = defaultdict(lambda: defaultdict(float))
    order = []
    cur, pending_m, prev, kb_up, run = None, False, None, False, None
    last_swipe = None
    last_pt = None  # last aimed touch point in this segment, mm

    def add(ph, key, v):
        phases[ph][key] += v
        phases[ph]["sec"] += v

    def aim(ph, edge_dp, xy):
        """Fitts index of difficulty of one aimed touch, from the previous touch point in this segment."""
        nonlocal last_pt
        pt = (float(xy[0]) * PX_TO_MM, float(xy[1]) * PX_TO_MM) if xy else None
        d = math.dist(pt, last_pt) if pt and last_pt else DEFAULT_D_MM
        phases[ph]["bits"] += fitts_bits(max(d, 1.0), edge_dp * MM_PER_DP)
        last_pt = pt

    for r in rows:
        ph, op = r.get("phase", "?"), r.get("op")
        if ph == "explore" or (task and not ph.startswith(task)):
            continue
        if ph != cur:
            cur, pending_m, prev, run, last_pt = ph, True, None, None, None
            if ph not in order:
                order.append(ph)
        if op == "shot":
            pending_m = True
            continue
        if op == "note":
            t = r.get("text", "")
            if POPUP_NOTE.search(t):
                add(ph, "R", P["R_popup"]); pending_m = True; phases[ph]["popups"] += 1
            if PINYIN_NOTE.search(t):
                # the text before was pinyin for Chinese: one pick from the IME candidate bar
                add(ph, "PT", (P["P"] + P["T"]) / hit_rate(CANDIDATE_DP)); phases[ph]["aims"] += 1
                aim(ph, CANDIDATE_DP, None)
            if DRAG_NOTE.search(t) and last_swipe is not None:
                # upgrade the last swipe from an untargeted flick to a precise drag (two aims, eyes on)
                ph0, hit0, xy0 = last_swipe
                p0, e0 = tier(hit0, xy0)
                add(ph0, "drag", (P["P"] + P["D"]) / (p0 * p0) - P["F"])
                phases[ph0]["eyes_free"] -= P["F"]
                phases[ph0]["aims"] += 2
                aim(ph0, e0, xy0); aim(ph0, e0, None)
                last_swipe = None
            continue
        if op not in ("tap", "long", "swipe", "scroll", "text", "key", "scrub"):
            continue

        hit = r.get("hit") or {}
        label = str(hit.get("label", ""))
        is_edit = "EditText" in str(hit.get("cls", ""))
        kind = ("keypad" if op == "tap" and (r.get("_kind") == "keypad" or KEYPAD.match(label)) else
                "stepper" if op == "tap" and STEPPER.match(label) else op)
        same = (prev is not None and prev.get("op") == "tap" and op == "tap" and kind != "keypad"
                and (prev.get("hit") or {}).get("label") == label
                and (prev.get("hit") or {}).get("w_dp") == hit.get("w_dp"))
        unit = (("stepper", label) if kind == "stepper" else ("scrub", label) if kind == "scrub"
                else (kind,) if kind in ("text", "keypad") else None)
        # leaving a typed value (text or keypad run): one glance back at it
        if run and run[0] in ("text", "keypad") and unit != run:
            add(ph, "S", P["S_micro"])
        # one M per value unit (a text field, a keypad run, a stepper run), merged with a pending locate-M;
        # a scroll / flick / back gesture has no target, so the locate-M waits for the next aimed action
        aimed = not (op in ("swipe", "scroll") or (op == "key" and r.get("key") in ("back", "home")))
        if aimed and (pending_m or (unit is not None and unit != run)):
            add(ph, "M", P["M"]); phases[ph]["Ms"] += 1
            pending_m = False
        run = unit

        if op == "tap" and kind == "keypad":
            add(ph, "K", P["K"]); phases[ph]["keys"] += 1; phases[ph]["bits"] += KEY_BITS
        elif op == "tap":
            p, edge = tier(hit, r.get("xy"))
            if same:
                add(ph, "T", P["T"] / p)  # finger stays put: no new aim, no bits
            else:
                t = (P["P"] + P["T"]) / p
                add(ph, "PT", t); phases[ph]["aims"] += 1
                aim(ph, edge, r.get("xy"))
                if edge >= FUZZY_DP:
                    phases[ph]["eyes_free"] += t  # half the screen wide: can be hit without looking
            if is_edit and not kb_up:
                add(ph, "R", P["R_kb"]); phases[ph]["keyboards"] += 1
            kb_up = is_edit or (kb_up and kind == "keypad")
        elif op == "long":
            p, edge = tier(hit, r.get("xy"))
            add(ph, "PT", (P["P"] + P["T"]) / p + P["R_long"]); phases[ph]["aims"] += 1; phases[ph]["longs"] += 1
            aim(ph, edge, r.get("xy"))
        elif op in ("swipe", "scroll"):
            add(ph, "F", P["F"]); pending_m = True; phases[ph]["scrolls"] += 1
            phases[ph]["eyes_free"] += P["F"]
            last_swipe = (ph, hit, r.get("xy")) if op == "swipe" else None
        elif op == "scrub":
            # detent drag (effort-standard.md §4 刻度拖动): aim the start like a tap, drag n detents, stop by
            # reading the number. Overshooting the last detent is a one-detent back-drag, not a redo, so it
            # costs (1 - hit(detent width)) x D instead of dividing by the hit rate. Two aims, eyes on.
            p, edge = tier(hit, r.get("xy"))
            n, det = int(r.get("detents", 1)), float(r.get("detent_dp", 10))
            add(ph, "drag", (P["P"] + P["D"]) / p + (1 - hit_rate(det)) * P["D"] + P["S_micro"])
            phases[ph]["aims"] += 2; phases[ph]["scrubs"] += 1
            aim(ph, edge, r.get("xy"))
            phases[ph]["bits"] += fitts_bits(n * det * MM_PER_DP, det * MM_PER_DP)
        elif op == "text":
            n = int(r.get("chars", 1))
            add(ph, "K", n * P["K"]); phases[ph]["keys"] += n; phases[ph]["bits"] += n * KEY_BITS
        elif op == "key":
            k = r.get("key", "")
            if k == "back":
                add(ph, "F", P["F"]); pending_m = True; phases[ph]["eyes_free"] += P["F"]
            elif k != "home":
                add(ph, "K", P["K"]); phases[ph]["keys"] += 1; phases[ph]["bits"] += KEY_BITS
        phases[ph]["actions"] += 1
        prev = r
    # a phase that ends inside a field still pays the final glance
    return order, phases


def report(path, task=None, as_json=False):
    order, phases = score(path, task)
    out = {"phases": {}, "kinds": {}, "totals": {}}
    for ph in order:
        d = phases[ph]
        dims = {"time": d["sec"], "precision": d["bits"], "visual": d["sec"] - d["eyes_free"], "cognitive": d["Ms"]}
        d["visual"] = dims["visual"]
        d["score"] = sum(WEIGHTS[k] * v / REF[k] for k, v in dims.items())
        out["phases"][ph] = {k: round(v, 2) for k, v in d.items()}
    dims = ("sec", "bits", "visual", "Ms", "score")
    by_kind = defaultdict(list)
    for ph, d in out["phases"].items():
        m = re.search(r"^(\w+)-(E\d-s\d)$", ph)
        if m:
            for k in KINDS.get(m.group(2), []):
                by_kind[(m.group(1), k)].append(d)
    for (t, k), v in by_kind.items():
        out["kinds"].setdefault(t, {})[k] = {x: round(sum(d.get(x, 0) for d in v) / len(v), 2) for x in dims}
    for t in sorted({ph.split("-")[0] for ph in order}):
        rows = [d for ph, d in out["phases"].items() if ph.split("-")[0] == t]
        out["totals"][t] = {x: round(sum(d.get(x, 0) for d in rows), 2) for x in dims}
    if as_json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return out
    print(f"{'phase':<14}{'sec':>7}{'bits':>7}{'eyes':>7}{'M':>4}{'score':>7}{'aims':>6}{'keys':>6}{'kb':>4}{'pop':>5}{'scr':>5}")
    for ph, d in out["phases"].items():
        print(f"{ph:<14}{d['sec']:>7.2f}{d.get('bits',0):>7.2f}{d.get('visual',0):>7.2f}{d.get('Ms',0):>4.0f}"
              f"{d.get('score',0):>7.2f}{d.get('aims',0):>6.0f}{d.get('keys',0):>6.0f}"
              f"{d.get('keyboards',0):>4.0f}{d.get('popups',0):>5.0f}{d.get('scrolls',0):>5.0f}")
    for t, ks in out["kinds"].items():
        for k, v in ks.items():
            print(f"kind {t} {k}: {v}")
    print("totals:", out["totals"])
    return out


if __name__ == "__main__":
    a = sys.argv[1:]
    task = a[a.index("--task") + 1] if "--task" in a else None
    report(a[0], task, "--json" in a)
