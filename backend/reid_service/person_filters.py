"""YOLO person 框后处理：可选置信度 / 形状过滤，减轻误检；默认偏宽松以免「有 YOLO 无框」。"""

from __future__ import annotations

import os


def yolo_score_ok(p: dict, *, min_conf: float | None = None) -> bool:
    if os.environ.get("PERSON_USE_CONF_FILTER", "1").strip() == "0":
        return True
    if min_conf is None:
        min_conf = float(os.environ.get("YOLO_KEEP_MIN_CONF", "0.22"))
    return float(p.get("conf", 0)) >= min_conf


def bbox_plausible_person(
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    frame_w: int,
    frame_h: int,
) -> bool:
    """行人框：高/宽与面积占画面比例在宽松范围内。PERSON_USE_SHAPE_FILTER=0 时跳过。"""
    if os.environ.get("PERSON_USE_SHAPE_FILTER", "1").strip() == "0":
        return True
    bw = max(1, x2 - x1)
    bh = max(1, y2 - y1)
    ar = bh / float(bw)
    ar_min = float(os.environ.get("PERSON_AR_MIN", "0.72"))
    ar_max = float(os.environ.get("PERSON_AR_MAX", "6.5"))
    if ar < ar_min or ar > ar_max:
        return False

    area_frac = (bw * bh) / float(max(1, frame_w * frame_h))
    a_min = float(os.environ.get("PERSON_AREA_MIN_FRAC", "0.0006"))
    a_max = float(os.environ.get("PERSON_AREA_MAX_FRAC", "0.55"))
    if area_frac < a_min or area_frac > a_max:
        return False

    return True
