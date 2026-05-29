"""
区域 / 输出层去重：
1) merge_output_layer_dets：同路最终框（强框 + 弱框）按 IoU 合并，避免叠画。
2) apply_overlap_camera_pair_dedupe：配置「视野重叠」的两路时，同一 globalPersonId 只保留其中一路的框。
"""

from __future__ import annotations

import os
from typing import Any


def iou_norm_xywh(a: dict[str, float], b: dict[str, float]) -> float:
    ax, ay, aw, ah = a["x"], a["y"], a["w"], a["h"]
    bx, by, bw, bh = b["x"], b["y"], b["w"], b["h"]
    a_x2, a_y2 = ax + aw, ay + ah
    b_x2, b_y2 = bx + bw, by + bh
    ix1 = max(ax, bx)
    iy1 = max(ay, by)
    ix2 = min(a_x2, b_x2)
    iy2 = min(a_y2, b_y2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    aa = max(1e-12, aw * ah)
    bb = max(1e-12, bw * bh)
    union = aa + bb - inter
    return float(inter / max(1e-12, union))


def _det_sort_key(d: dict[str, Any]) -> tuple[int, float, float]:
    """强框优先，其次置信度，其次面积。"""
    weak = 1 if d.get("lowConfidence") else 0
    conf = float(d.get("confidence", 0.0))
    box = d.get("box") or {}
    w = float(box.get("w", 0)) * float(box.get("h", 0))
    return (weak, -conf, -w)


def merge_output_layer_dets(dets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    同路输出列表（含弱框）greedy IoU：与已保留框 IoU>=阈值则丢弃弱/低优先级。
    OUTPUT_LAYER_NMS_IOU 默认 0.42；OUTPUT_LAYER_NMS=0 关闭。
    """
    if os.environ.get("OUTPUT_LAYER_NMS", "1").strip().lower() in ("0", "false", "off", "no"):
        return dets
    thr = float(os.environ.get("OUTPUT_LAYER_NMS_IOU", "0.42"))
    thr = max(0.05, min(0.95, thr))
    work = [d for d in dets if isinstance(d.get("box"), dict)]
    if len(work) <= 1:
        return work
    work.sort(key=_det_sort_key)
    keep: list[dict[str, Any]] = []
    for d in work:
        box = d["box"]
        if not all(iou_norm_xywh(box, k["box"]) < thr for k in keep):
            continue
        keep.append(d)
    return keep


def _parse_overlap_pairs() -> list[tuple[str, str]]:
    raw = os.environ.get("REID_OVERLAP_PAIRS", "").strip()
    if not raw:
        return []
    out: list[tuple[str, str]] = []
    for part in raw.split("|"):
        part = part.strip()
        if not part or "," not in part:
            continue
        a, b = part.split(",", 1)
        a, b = a.strip(), b.strip()
        if a and b:
            out.append((a, b))
    return out


def apply_overlap_camera_pair_dedupe(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    REID_OVERLAP_PAIRS 示例：stairs_1,stairs_2|room,board_game
    每对中保留「前者」路上的该 globalPersonId，从后者路上删掉同 ID 的框（重叠区域同一人只画一次）。
    仅处理正数 Re-ID id；弱框不参与。
    """
    pairs = _parse_overlap_pairs()
    if not pairs:
        return frames
    by_id = {f["cameraId"]: f for f in frames if isinstance(f.get("cameraId"), str)}
    for keep_cam, drop_cam in pairs:
        fa = by_id.get(keep_cam)
        fb = by_id.get(drop_cam)
        if not fa or not fb or not fa.get("online") or not fb.get("online"):
            continue
        dets_a = fa.get("detections") or []
        gids = {
            int(d["globalPersonId"])
            for d in dets_a
            if isinstance(d, dict) and int(d.get("globalPersonId", 0)) > 0
        }
        if not gids:
            continue
        dets_b = list(fb.get("detections") or [])
        new_b = [
            d
            for d in dets_b
            if not (
                isinstance(d, dict)
                and int(d.get("globalPersonId", 0)) > 0
                and int(d["globalPersonId"]) in gids
            )
        ]
        fb["detections"] = new_b
    return frames
