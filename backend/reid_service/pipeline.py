from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import cv2
import numpy as np

from box_nms import dedupe_person_boxes
from camera_tracker import PerCameraTracker, global_match_order_enabled, tracking_enabled
from cameras_data import CAMERAS
from pose_feature import assign_poses_to_detections, detect_poses, pose_similarity
from capture import grab_rtsp_frame, rtsp_probe_is_404
from fallback_feat import fallback_reid_vector
from frame_quality import frame_looks_corrupt
from gallery_store import CosineGallery
from person_filters import bbox_plausible_person, yolo_score_ok
from preview_store import set_preview_jpeg
from region_dedupe import apply_overlap_camera_pair_dedupe, iou_norm_xywh, merge_output_layer_dets
from reid_embedder_factory import get_embedder
from test_data_source import grab_test_frame, reset_test_state, test_camera_list, test_dataset_has_data
from yolo_detect import detect_persons

_data_mode: str = "camera"  # "camera" | "dataset"


class PipelineState:
    def __init__(self) -> None:
        self.gallery = CosineGallery()
        self.cam_trackers: dict[str, PerCameraTracker] = {}


_states: dict[str, PipelineState] = {"default": PipelineState()}


def get_data_mode() -> str:
    return _data_mode


def set_data_mode(mode: str) -> None:
    global _data_mode
    mode = mode.strip().lower()
    if mode not in ("camera", "dataset"):
        raise ValueError(f"invalid mode: {mode}")
    if mode != _data_mode:
        _data_mode = mode
        _states.clear()
        _states["default"] = PipelineState()
        reset_test_state()


def _state_for(namespace: str) -> PipelineState:
    ns = namespace.strip() if namespace else "default"
    if not ns:
        ns = "default"
    if ns not in _states:
        _states[ns] = PipelineState()
    return _states[ns]


def _tracker_for(state: PipelineState, camera_id: str) -> PerCameraTracker:
    if camera_id not in state.cam_trackers:
        state.cam_trackers[camera_id] = PerCameraTracker()
    return state.cam_trackers[camera_id]


def _gallery_max_tta_enabled() -> bool:
    return os.environ.get("REID_GALLERY_MAX_TTA", "0").strip().lower() in ("1", "true", "yes", "on")


def _grab_pair(cam: dict[str, str]) -> tuple[str, Any]:
    url = cam["url"]
    if rtsp_probe_is_404(url):
        return cam["id"], None
    return cam["id"], grab_rtsp_frame(url, camera_id=cam["id"])


def _maybe_refresh_corrupt_frame(cid: str, url: str, frame: np.ndarray) -> np.ndarray:
    """花屏时在同一路上额外抓几次，尽量换一帧再送给 YOLO / 预览。"""
    if not frame_looks_corrupt(frame):
        return frame
    extra = int(os.environ.get("RTSP_GRAB_CORRUPT_EXTRA_TRIES", "4"))
    extra = max(0, min(12, extra))
    for _ in range(extra):
        f2 = grab_rtsp_frame(url, camera_id=cid)
        if f2 is not None and not frame_looks_corrupt(f2):
            return f2
    return frame


def _pad_xyxy(xyxy: list[float], w: int, h: int, pad: float) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = xyxy
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    x1 -= bw * pad
    x2 += bw * pad
    y1 -= bh * pad
    y2 += bh * pad
    x1i = int(max(0, np.floor(x1)))
    y1i = int(max(0, np.floor(y1)))
    x2i = int(min(w - 1, np.ceil(x2)))
    y2i = int(min(h - 1, np.ceil(y2)))
    return x1i, y1i, x2i, y2i


def _split_same_frame_reused_global_ids(rows: list[dict[str, Any]], gallery: CosineGallery) -> None:
    """
    同一帧两个框被标成同一 globalPersonId 时，检查是否真的是同一个人：
    - IoU 很低 (< 0.20)：空间上明显是两个人 → 拆分
    - IoU 中等 (0.20-0.45)：体态不一致 → 拆分（体态一致 → 可能是同一人重检，保留）
    - IoU 很高 (≥ 0.45)：同一个人被检测两次 → 保留
    可关：REID_SAME_FRAME_IOU_SPLIT=0。
    """
    if len(rows) < 2:
        return
    if os.environ.get("REID_SAME_FRAME_IOU_SPLIT", "1").strip().lower() in ("0", "false", "off", "no"):
        return
    iou_clear_same = 0.50    # Above this: definitely same person double-detected → keep
    pose_thr = float(os.environ.get("REID_SAME_FRAME_POSE_MIN_SIM", "0.65"))

    changed = True
    rounds = 0
    while changed and rounds < 12:
        changed = False
        rounds += 1
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                gi = int(rows[i]["globalPersonId"])
                gj = int(rows[j]["globalPersonId"])
                if gi <= 0 or gi != gj:
                    continue
                iou = iou_norm_xywh(rows[i]["box"], rows[j]["box"])

                should_split = False
                if iou >= iou_clear_same:
                    # High overlap → might be same person double-detected
                    # Check pose to confirm: if poses also match → keep as same
                    pi = rows[i].get("_pose_vec")
                    pj = rows[j].get("_pose_vec")
                    if pi is not None and pj is not None and pi.size > 0 and pj.size > 0:
                        if pose_similarity(pi, pj) >= pose_thr:
                            continue  # Same person double-detected → keep
                    else:
                        continue  # No pose data, give benefit of doubt → keep
                # Low/zero overlap → clearly different people, or pose mismatch → SPLIT
                should_split = True

                if not should_split:
                    continue

                ci = float(rows[i].get("_conf", 0.0))
                cj = float(rows[j].get("_conf", 0.0))
                loser = j if cj <= ci else i
                feat = rows[loser]["_feat"]
                alt = rows[loser].get("_feat_alt")
                rows[loser]["globalPersonId"] = gallery.force_new_id(feat, feat_alt=alt)
                changed = True


def _xyxy_to_norm_xywh(xyxy: list[float], w: int, h: int) -> dict[str, float]:
    x1, y1, x2, y2 = xyxy
    bw = max(1e-6, (x2 - x1) / float(w))
    bh = max(1e-6, (y2 - y1) / float(h))
    return {"x": float(x1) / float(w), "y": float(y1) / float(h), "w": bw, "h": bh}


def _encode_preview_jpeg(bgr: np.ndarray) -> bytes | None:
    q = int(os.environ.get("DETECTION_PREVIEW_JPEG_QUALITY", "72"))
    q = max(40, min(95, q))
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), q])
    if not ok or buf is None:
        return None
    return bytes(buf)


def _global_row_sort_key(row: dict[str, Any]) -> tuple[float, float]:
    """全路统一进画廊时的顺序：高置信、大框优先，减少小路数抢占 global id 导致跨镜错配。"""
    b = row.get("box") or {}
    area = float(b.get("w", 0.0)) * float(b.get("h", 0.0))
    return (-float(row.get("_conf", 0.0)), -area)


def build_detections_payload(
    cameras: list[dict[str, str]] | None = None,
    namespace: str = "default",
) -> dict[str, Any]:
    """
    抓帧 → YOLO → Re-ID 特征 → 绑定 globalPersonId。
    默认 REID_GLOBAL_MATCH_ORDER=1：同一次采样内全路强检框按置信度与框面积排序后统一 match_or_create，再按路挂轨迹，
    减轻「一路先跑、抢占 id」造成的跨摄像头同一人多 id。
    关 REID_GLOBAL_MATCH_ORDER=0 则恢复为按摄像头顺序各自进画廊（与旧版一致）。
    """
    embedder = get_embedder()
    state = _state_for(namespace)
    max_tta = _gallery_max_tta_enabled()
    pad = float(os.environ.get("CROP_PAD", "0.1"))
    min_side = int(os.environ.get("CROP_MIN_SIDE", "24"))
    min_side_new = int(os.environ.get("CROP_MIN_SIDE_FOR_NEW", str(max(64, min_side * 2))))
    want_stats = os.environ.get("DETECTIONS_STATS", "1").strip().lower() not in ("0", "false", "off", "no")
    per_cam_stats: list[dict[str, Any]] = []

    # --- frame source: RTSP cameras or local test dataset ---
    if _data_mode == "dataset":
        active_cameras = test_camera_list()
    else:
        active_cameras = [dict(c) for c in (cameras if cameras is not None else CAMERAS)]

    by_id: dict[str, Any] = {}
    if _data_mode == "dataset":
        for cam in active_cameras:
            fr = grab_test_frame(cam["id"])
            by_id[cam["id"]] = fr
    else:
        workers = max(1, int(os.environ.get("CAMERA_FETCH_WORKERS", "6")))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pairs = list(pool.map(_grab_pair, active_cameras))
        by_id = {cid: fr for cid, fr in pairs}

        cam_url = {c["id"]: c["url"] for c in active_cameras}
        for cid in list(by_id.keys()):
            fr = by_id.get(cid)
            if fr is None:
                continue
            url = cam_url.get(cid, "")
            if not url or rtsp_probe_is_404(url):
                continue
            by_id[cid] = _maybe_refresh_corrupt_frame(cid, url, fr)

    frames: list[dict[str, Any]] = []
    tick_by_cid: dict[str, dict[str, Any]] = {}

    for cam in active_cameras:
        cid = cam["id"]
        frame = by_id.get(cid)
        if frame is None:
            tick_by_cid[cid] = {"online": False}
            continue

        skip_yolo = (
            os.environ.get("REID_SKIP_YOLO_ON_CORRUPT_FRAME", "0").strip().lower() in ("1", "true", "yes", "on")
            and frame_looks_corrupt(frame)
        )

        H, W = frame.shape[:2]
        yolo_n = 0
        yolo_raw_n = 0
        embed_fail = 0
        passed_conf = 0
        passed_minside = 0
        passed_shape = 0

        if skip_yolo:
            persons_raw = []
        else:
            try:
                persons_raw = detect_persons(frame)
            except Exception:
                persons_raw = []
        yolo_raw_n = len(persons_raw)
        persons = dedupe_person_boxes(persons_raw)
        yolo_n = len(persons)

        # Pose detection: extract keypoints and assign to YOLO detections for same-frame dedup
        _use_pose = os.environ.get("REID_USE_POSE", "1").strip() in ("1", "true", "yes", "on")
        if _use_pose and not skip_yolo:
            try:
                pose_dets = detect_poses(frame)
                assign_poses_to_detections(persons, pose_dets)
            except Exception:
                pass

        strong_rows: list[dict[str, Any]] = []
        for p in persons:
            if not yolo_score_ok(p):
                continue
            passed_conf += 1
            xyxy = p["xyxy"]
            x1i, y1i, x2i, y2i = _pad_xyxy(xyxy, W, H, pad)
            if x2i - x1i < min_side or y2i - y1i < min_side:
                continue
            passed_minside += 1
            if not bbox_plausible_person(x1i, y1i, x2i, y2i, W, H):
                continue
            passed_shape += 1
            crop = frame[y1i:y2i, x1i:x2i]
            feat: np.ndarray | None = None
            feat_alt: np.ndarray | None = None
            _use_color = os.environ.get("REID_USE_COLOR_FEATURES", "1").strip() in ("1", "true", "yes", "on")
            try:
                if _use_color:
                    from hybrid_embedder import color_augmented_embed
                    crop_h = y2i - y1i
                    if max_tta:
                        # Gallery max-TTA: get raw original/flipped features
                        f0 = color_augmented_embed(embedder, crop, crop_h=crop_h, tta=False)
                        f1 = color_augmented_embed(embedder, cv2.flip(crop, 1), crop_h=crop_h, tta=False)
                        feat, feat_alt = f0, f1
                    else:
                        feat = color_augmented_embed(embedder, crop, crop_h=crop_h)
                elif max_tta:
                    feat, feat_alt = embedder.embed_crop_bgr_mirror_pair(crop)
                else:
                    feat = embedder.embed_crop_bgr(crop)
            except Exception:
                embed_fail += 1
                if os.environ.get("SKIP_REID_FALLBACK", "").strip() != "1":
                    try:
                        feat = fallback_reid_vector(crop, camera_id=cid, box_xyxy=(x1i, y1i, x2i, y2i))
                        feat_alt = None
                    except Exception:
                        feat = None
            if feat is None:
                continue
            crop_w, crop_h = x2i - x1i, y2i - y1i
            box = _xyxy_to_norm_xywh([float(x1i), float(y1i), float(x2i), float(y2i)], W, H)
            strong_rows.append(
                {
                    "box": box,
                    "_feat": feat,
                    "_feat_alt": feat_alt,
                    "_conf": float(p.get("conf", 0.0)),
                    "_no_new_id": (crop_w < min_side_new and crop_h < min_side_new),
                    "_pose_vec": p.get("_pose_vec"),
                }
            )
        tick_by_cid[cid] = {
            "online": True,
            "frame": frame,
            "H": H,
            "W": W,
            "skip_yolo": skip_yolo,
            "persons": persons,
            "strong_rows": strong_rows,
            "yolo_n": yolo_n,
            "yolo_raw_n": yolo_raw_n,
            "embed_fail": embed_fail,
            "passed_conf": passed_conf,
            "passed_minside": passed_minside,
            "passed_shape": passed_shape,
        }

    use_global = global_match_order_enabled()
    if use_global:
        flat: list[tuple[str, dict[str, Any]]] = []
        for cam in active_cameras:
            cid = cam["id"]
            t = tick_by_cid.get(cid)
            if not t or not t.get("online"):
                continue
            for row in t["strong_rows"]:
                flat.append((cid, row))
        flat.sort(key=lambda cr: _global_row_sort_key(cr[1]))
        for _cid, row in flat:
            if row.get("_no_new_id"):
                row["globalPersonId"] = 0
            else:
                row["globalPersonId"] = int(state.gallery.match_or_create(
                    row["_feat"], feat_alt=row.get("_feat_alt"),
                    pose_vec=row.get("_pose_vec"),
                ))

    tr_on = tracking_enabled()
    for cam in active_cameras:
        cid = cam["id"]
        t = tick_by_cid[cid]
        if not t.get("online"):
            if want_stats:
                per_cam_stats.append(
                    {
                        "cameraId": cid,
                        "online": False,
                        "yoloRawPersons": 0,
                        "yoloPersons": 0,
                        "passedConf": 0,
                        "passedMinSide": 0,
                        "passedShape": 0,
                        "outputBoxes": 0,
                        "weakOutputBoxes": 0,
                        "embedFailures": 0,
                    }
                )
            frames.append({"cameraId": cid, "online": False, "detections": []})
            set_preview_jpeg(cid, None)
            continue

        frame = t["frame"]
        H, W = t["H"], t["W"]
        skip_yolo = t["skip_yolo"]
        persons = t["persons"]
        strong_rows = t["strong_rows"]
        yolo_raw_n = t["yolo_raw_n"]
        yolo_n = t["yolo_n"]
        embed_fail = t["embed_fail"]
        passed_conf = t["passed_conf"]
        passed_minside = t["passed_minside"]
        passed_shape = t["passed_shape"]

        strong_dets: list[dict[str, Any]] = []
        demoted_rows: list[dict[str, Any]] = []  # _no_new_id → couldn't match → show as weak
        if tr_on:
            if use_global:
                _tracker_for(state, cid).ingest_assigned_global_ids(strong_rows)
            else:
                _tracker_for(state, cid).assign_global_ids(strong_rows, state.gallery)
        else:
            if not use_global:
                for row in strong_rows:
                    if row.get("_no_new_id"):
                        row["globalPersonId"] = 0
                    else:
                        row["globalPersonId"] = int(state.gallery.match_or_create(
                            row["_feat"], feat_alt=row.get("_feat_alt"),
                            pose_vec=row.get("_pose_vec"),
                        ))

        _split_same_frame_reused_global_ids(strong_rows, state.gallery)
        if tr_on:
            _tracker_for(state, cid).sync_gids_after_split(strong_rows)
        for row in strong_rows:
            gid = int(row["globalPersonId"])
            if gid > 0:
                strong_dets.append({"globalPersonId": gid, "box": row["box"]})
            else:
                demoted_rows.append(row)

        weak_dets: list[dict[str, Any]] = []
        weak_on = os.environ.get("YOLO_WEAK_BOXES", "1").strip().lower() not in ("0", "false", "off", "no")
        weak_min = float(os.environ.get("YOLO_WEAK_SHOW_MIN", "0.06"))
        weak_min_side = int(os.environ.get("YOLO_WEAK_MIN_SIDE", "16"))
        # Add demoted rows as weak boxes (shown with orange border, no global ID)
        wk = 0
        for row in demoted_rows:
            wk += 1
            weak_dets.append({
                "globalPersonId": -wk,
                "box": row["box"],
                "lowConfidence": True,
                "confidence": round(float(row.get("_conf", 0.0)), 4),
            })
        if weak_on and not skip_yolo:
            # wk continues from demoted_rows count above
            for p in persons:
                if yolo_score_ok(p):
                    continue
                cf = float(p.get("conf", 0.0))
                if cf < weak_min:
                    continue
                xyxy = p["xyxy"]
                x1i, y1i, x2i, y2i = _pad_xyxy(xyxy, W, H, pad)
                if x2i - x1i < weak_min_side or y2i - y1i < weak_min_side:
                    continue
                wk += 1
                box = _xyxy_to_norm_xywh([float(x1i), float(y1i), float(x2i), float(y2i)], W, H)
                weak_dets.append(
                    {
                        "globalPersonId": -wk,
                        "box": box,
                        "lowConfidence": True,
                        "confidence": round(cf, 4),
                    }
                )

        dets_out = merge_output_layer_dets(weak_dets + strong_dets)
        if want_stats:
            st: dict[str, Any] = {
                "cameraId": cid,
                "online": True,
                "yoloRawPersons": yolo_raw_n,
                "yoloPersons": yolo_n,
                "passedConf": passed_conf,
                "passedMinSide": passed_minside,
                "passedShape": passed_shape,
                "outputBoxes": len([d for d in dets_out if not d.get("lowConfidence")]),
                "weakOutputBoxes": len([d for d in dets_out if d.get("lowConfidence")]),
                "embedFailures": embed_fail,
            }
            if tr_on:
                st["activeTracks"] = _tracker_for(state, cid).active_track_count()
                st["dormantTracks"] = _tracker_for(state, cid).dormant_count()
            per_cam_stats.append(st)
        frames.append({"cameraId": cid, "online": True, "detections": dets_out})

        if _data_mode == "dataset" or not frame_looks_corrupt(frame):
            pj = _encode_preview_jpeg(frame)
            if pj:
                set_preview_jpeg(cid, pj)

    frames = apply_overlap_camera_pair_dedupe(frames)

    visible_after: set[int] = set()
    for f in frames:
        if not f.get("online"):
            continue
        for d in f.get("detections") or []:
            if isinstance(d, dict):
                g = int(d.get("globalPersonId", 0))
                if g > 0:
                    visible_after.add(g)
    visible_n = len(visible_after)

    now = int(time.time() * 1000)
    interval = int(os.environ.get("SAMPLE_INTERVAL_MS", "3000"))
    gallery_n = state.gallery.gallery_size()
    out: dict[str, Any] = {
        "updatedAt": now,
        "sampleIntervalMs": interval,
        # 前端「当前人数」用 visible；gallery 为历史出现过的全局 id 数（含已离开）
        "galleryUniquePersonCount": gallery_n,
        "visibleUniquePersonCount": visible_n,
        "frames": frames,
    }
    if want_stats:
        out["stats"] = {"cameras": per_cam_stats}
    return out
