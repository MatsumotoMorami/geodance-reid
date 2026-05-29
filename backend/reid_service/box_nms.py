"""YOLO 多人框 IoU 重叠去重（按置信度保留高分框）。"""

from __future__ import annotations

import os
from typing import Any


def iou_xyxy_xyxy(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    aa = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    bb = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = aa + bb - inter + 1e-9
    return float(inter / union)


def dedupe_person_boxes(persons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    标准 greedy NMS：按 conf 降序，与已保留框 IoU >= 阈值则丢弃。
    YOLO_PERSON_NMS=0 关闭；YOLO_PERSON_NMS_IOU 默认 0.5。
    """
    if os.environ.get("YOLO_PERSON_NMS", "1").strip().lower() in ("0", "false", "off", "no"):
        return persons
    thr = float(os.environ.get("YOLO_PERSON_NMS_IOU", "0.5"))
    thr = max(0.05, min(0.95, thr))
    dets = [p for p in persons if isinstance(p.get("xyxy"), list) and len(p["xyxy"]) == 4]
    if len(dets) <= 1:
        return dets
    dets.sort(key=lambda p: -float(p.get("conf", 0.0)))
    keep: list[dict[str, Any]] = []
    for p in dets:
        xy = p["xyxy"]
        if all(iou_xyxy_xyxy(xy, k["xyxy"]) < thr for k in keep):
            keep.append(p)
    return keep
