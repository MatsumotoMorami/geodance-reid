"""
Pose feature extraction for person re-identification.
Extracts lightweight pose descriptors from person keypoints to help:
1. Same-frame dedup: two people in the same frame should have different poses
2. Cross-camera consistency: same person across cameras has similar pose

Uses YOLOv8-pose for keypoint detection on the full frame.
"""

from __future__ import annotations

import os
from typing import Any

import cv2
import numpy as np

# 17 COCO keypoints
KP = {
    "nose": 0, "left_eye": 1, "right_eye": 2, "left_ear": 3, "right_ear": 4,
    "left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8,
    "left_wrist": 9, "right_wrist": 10, "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14, "left_ankle": 15, "right_ankle": 16,
}

# Limb pairs for angle computation
LIMBS = [
    (5, 7), (7, 9),   # left arm: shoulder→elbow→wrist
    (6, 8), (8, 10),  # right arm
    (11, 13), (13, 15),  # left leg: hip→knee→ankle
    (12, 14), (14, 16),  # right leg
    (5, 11), (6, 12),  # torso sides
]

_pose_model: Any = None


def _get_pose_model():
    global _pose_model
    if _pose_model is None:
        from ultralytics import YOLO
        model_name = os.environ.get("POSE_MODEL", "yolov8n-pose.pt")
        _pose_model = YOLO(model_name)
    return _pose_model


def detect_poses(frame: np.ndarray) -> list[dict[str, Any]]:
    """
    Run YOLOv8-pose on the full frame.
    Returns list of {xyxy, conf, keypoints: {name: (x,y,conf)}} for each detected person.
    """
    model = _get_pose_model()
    device = os.environ.get("YOLO_DEVICE", "cpu")
    conf = float(os.environ.get("YOLO_CONF", "0.08"))
    imgsz = int(os.environ.get("YOLO_IMGSZ", "960"))

    h, w = frame.shape[:2]
    m = max(h, w)
    max_side = int(os.environ.get("YOLO_MAX_SIDE", "1280"))
    scale = 1.0
    work = frame
    if m > max_side:
        scale = max_side / float(m)
        work = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    results = model.predict(work, conf=conf, classes=[0], device=device, imgsz=imgsz, verbose=False)
    r0 = results[0] if results else None
    if r0 is None or r0.keypoints is None:
        return []

    kpts = r0.keypoints
    boxes = r0.boxes
    if boxes is None or len(boxes) == 0:
        return []

    inv = 1.0 / scale if scale != 1.0 else 1.0
    out = []
    for i in range(len(boxes)):
        xyxy = (boxes.xyxy[i].cpu().numpy() * inv).tolist()
        kp_data = kpts.data[i].cpu().numpy()  # (17, 3): x, y, conf
        keypoints = {}
        for name, idx in KP.items():
            x, y, c = kp_data[idx]
            if c > 0.3:  # Only keep confident keypoints
                keypoints[name] = (float(x * inv), float(y * inv), float(c))
        out.append({
            "xyxy": [float(v) for v in xyxy],
            "conf": float(boxes.conf[i]),
            "keypoints": keypoints,
        })
    return out


def extract_pose_vector(keypoints: dict[str, tuple[float, float, float]],
                        bbox_w: float, bbox_h: float) -> np.ndarray:
    """
    Extract a normalized pose feature vector from keypoints.
    Returns 32-dim L2-normalized vector (limb angles + relative positions).
    """
    feat_parts = []

    # 1. Limb angles (10 limbs → 10 dims)
    for a, b in LIMBS:
        name_a = [n for n, i in KP.items() if i == a][0]
        name_b = [n for n, i in KP.items() if i == b][0]
        if name_a in keypoints and name_b in keypoints:
            ax, ay, _ = keypoints[name_a]
            bx, by, _ = keypoints[name_b]
            angle = np.arctan2(by - ay, bx - ax) / np.pi  # normalized to [-1, 1]
            feat_parts.append(angle)
        else:
            feat_parts.append(0.0)

    # 2. Normalized keypoint positions relative to bbox center (17×2=34 → reduce to 16 using key subsets)
    if bbox_w > 0 and bbox_h > 0:
        key_kps = ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
                    "left_wrist", "right_wrist", "left_hip", "right_hip",
                    "left_knee", "right_knee", "left_ankle", "right_ankle"]
        for name in key_kps:
            if name in keypoints:
                kx, ky, _ = keypoints[name]
                feat_parts.append(kx / bbox_w)
                feat_parts.append(ky / bbox_h)
            else:
                feat_parts.append(0.0)
                feat_parts.append(0.0)
    else:
        feat_parts.extend([0.0] * 26)

    # 3. Visibility ratio (how many keypoints were detected / 17)
    vis = len(keypoints) / 17.0
    feat_parts.append(vis)

    # 4. Upper/lower body ratio (torso to leg ratio)
    if "left_shoulder" in keypoints and "left_hip" in keypoints and "left_knee" in keypoints:
        sy, _, _ = keypoints["left_shoulder"]
        hy, _, _ = keypoints["left_hip"]
        ky, _, _ = keypoints["left_knee"]
        torso = abs(hy - sy)
        leg = abs(ky - hy)
        ratio = torso / (leg + 1e-6)
        feat_parts.append(min(ratio, 3.0) / 3.0)
    else:
        feat_parts.append(0.0)

    vec = np.array(feat_parts, dtype=np.float32)
    n = np.linalg.norm(vec) + 1e-12
    return vec / n


def pose_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Cosine similarity between two pose feature vectors."""
    return float(np.dot(vec_a.reshape(-1), vec_b.reshape(-1)))


def poses_consistent(vec_a: np.ndarray, vec_b: np.ndarray,
                     min_similarity: float = 0.35) -> bool:
    """
    Check if two poses could be the same person at the same time.
    Returns False if poses are drastically different (different postures).
    """
    sim = pose_similarity(vec_a, vec_b)
    return sim >= min_similarity


def assign_poses_to_detections(
    yolo_dets: list[dict[str, Any]],
    pose_dets: list[dict[str, Any]],
    iou_thr: float = 0.5,
) -> None:
    """Match pose detections to YOLO detections by IoU, add _pose_vec to matched detections."""
    for yd in yolo_dets:
        yd["_pose_vec"] = np.zeros(38, dtype=np.float32)  # default empty (matches extract_pose_vector dims)
        best_iou = 0.0
        best_pd = None
        for pd in pose_dets:
            iou = _box_iou(yd["xyxy"], pd["xyxy"])
            if iou > best_iou:
                best_iou = iou
                best_pd = pd
        if best_pd and best_iou >= iou_thr:
            kp = best_pd["keypoints"]
            x1, y1, x2, y2 = yd["xyxy"]
            vec = extract_pose_vector(kp, x2 - x1, y2 - y1)
            yd["_pose_vec"] = vec
            yd["_keypoints"] = kp


def _box_iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, ix2 = max(ax1, bx1), min(ax2, bx2)
    iy1, iy2 = max(ay1, by1), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    aa = max(1, (ax2 - ax1) * (ay2 - ay1))
    bb = max(1, (bx2 - bx1) * (by2 - by1))
    return inter / (aa + bb - inter + 1e-9)
