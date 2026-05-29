"""
每路摄像头：跨采样周期用 IoU + 中心位移 + Re-ID 余弦 将检测关联到本地轨迹，
复用轨迹已绑定的 globalPersonId；轨迹因久未检出被移除时进入「休眠池」，
保留 global id 与外观，人再次入画时优先用偏外观的宽松匹配复活为同一人。

关 REID_PER_CAMERA_TRACK=0 则退回「每框直接进画廊」的旧逻辑。
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import numpy as np

from region_dedupe import iou_norm_xywh

if TYPE_CHECKING:
    from gallery_store import CosineGallery


def tracking_enabled() -> bool:
    return os.environ.get("REID_PER_CAMERA_TRACK", "1").strip().lower() not in ("0", "false", "off", "no")


def global_match_order_enabled() -> bool:
    """同一次 /detections 采样内，全路强检框统一排序后再进画廊，减轻跨路 id 错配（关 REID_GLOBAL_MATCH_ORDER=0）。"""
    return os.environ.get("REID_GLOBAL_MATCH_ORDER", "1").strip().lower() not in ("0", "false", "off", "no")


def _unit_vec(feat: np.ndarray) -> np.ndarray:
    x = feat.reshape(-1).astype(np.float64)
    n = float(np.linalg.norm(x)) + 1e-12
    return (x / n).astype(np.float32)


def _center_dist_norm(a: dict[str, float], b: dict[str, float]) -> float:
    acx = float(a["x"]) + 0.5 * float(a["w"])
    acy = float(a["y"]) + 0.5 * float(a["h"])
    bcx = float(b["x"]) + 0.5 * float(b["w"])
    bcy = float(b["y"]) + 0.5 * float(b["h"])
    scale = max(float(a["w"]), float(a["h"]), float(b["w"]), float(b["h"]), 0.05)
    return float(np.hypot((acx - bcx) / scale, (acy - bcy) / scale))


@dataclass
class _LocalTrack:
    tid: int
    last_box: dict[str, float]
    feat_ema: np.ndarray
    global_gid: int
    missed: int = 0


@dataclass
class _DormantRecord:
    """离开画面较久的轨迹：保留 global id 与外观，回画时优先用外观再识别为同一人。"""

    global_gid: int
    feat_ema: np.ndarray
    last_box: dict[str, float]
    archived_ms: int


class PerCameraTracker:
    def __init__(self) -> None:
        self._tracks: dict[int, _LocalTrack] = {}
        self._next_tid = 1
        self._dormant: list[_DormantRecord] = []

    def _weights(self) -> tuple[float, float, float, float, float]:
        wi = float(os.environ.get("TRACK_MATCH_IOU_W", "0.22"))
        wc = float(os.environ.get("TRACK_MATCH_COS_W", "0.58"))
        wz = float(os.environ.get("TRACK_MATCH_CENTER_W", "0.20"))
        sharp = float(os.environ.get("TRACK_CENTER_SHARP", "2.5"))
        min_score = float(os.environ.get("TRACK_MATCH_MIN_SCORE", "0.40"))
        min_score = max(0.05, min(0.98, min_score))
        return wi, wc, wz, sharp, min_score

    def _feat_local_beta(self) -> float:
        b = float(os.environ.get("TRACK_FEAT_LOCAL_EMA", "0.28"))
        return max(0.05, min(0.95, b))

    def _max_missed(self) -> int:
        m = int(os.environ.get("TRACK_MAX_MISSED", "8"))
        return max(1, min(120, m))

    def _dormant_max(self) -> int:
        m = int(os.environ.get("TRACK_DORMANT_MAX", "96"))
        return max(8, min(800, m))

    def _dormant_ttl_sec(self) -> float:
        t = float(os.environ.get("TRACK_DORMANT_TTL_SEC", "0"))
        return max(0.0, min(8640000.0, t))

    def _archive_to_dormant(self, tr: _LocalTrack) -> None:
        self._dormant.append(
            _DormantRecord(
                global_gid=int(tr.global_gid),
                feat_ema=tr.feat_ema.copy(),
                last_box=dict(tr.last_box),
                archived_ms=int(time.time() * 1000),
            )
        )
        cap = self._dormant_max()
        while len(self._dormant) > cap:
            self._dormant.pop(0)

    def _expire_dormant_ttl(self) -> None:
        ttl = self._dormant_ttl_sec()
        if ttl <= 0:
            return
        now_ms = int(time.time() * 1000)
        ttl_ms = ttl * 1000.0
        self._dormant = [d for d in self._dormant if (now_ms - d.archived_ms) <= ttl_ms]

    def _dormant_pair_score(self, row: dict[str, Any], dr: _DormantRecord) -> float:
        """再入画时位置可能差很多，弱化 IoU/中心，主要看 Re-ID 余弦。"""
        wdi = float(os.environ.get("TRACK_DORMANT_IOU_W", "0.08"))
        wdc = float(os.environ.get("TRACK_DORMANT_COS_W", "0.82"))
        wdz = float(os.environ.get("TRACK_DORMANT_CENTER_W", "0.10"))
        sharp_d = float(os.environ.get("TRACK_DORMANT_CENTER_SHARP", "0.35"))
        iou = iou_norm_xywh(row["box"], dr.last_box)
        fu = _unit_vec(row["_feat"])
        c = max(0.0, float(np.dot(fu, dr.feat_ema.astype(np.float64))))
        d = _center_dist_norm(row["box"], dr.last_box)
        z = 1.0 / (1.0 + sharp_d * d)
        return wdi * float(iou) + wdc * c + wdz * z

    def _pair_score(self, row: dict[str, Any], tr: _LocalTrack) -> float:
        wi, wc, wz, sharp, _ = self._weights()
        iou = iou_norm_xywh(row["box"], tr.last_box)
        fu = _unit_vec(row["_feat"])
        c = max(0.0, float(np.dot(fu, tr.feat_ema.astype(np.float64))))
        d = _center_dist_norm(row["box"], tr.last_box)
        z = 1.0 / (1.0 + sharp * d)
        return wi * iou + wc * c + wz * z

    def assign_global_ids(self, rows: list[dict[str, Any]], gallery: CosineGallery) -> None:
        """对 rows 就地写入 globalPersonId、_tid；活跃轨迹 + 休眠池再入画匹配 + 新轨迹。"""
        max_missed = self._max_missed()
        if not rows:
            for tid in list(self._tracks.keys()):
                self._tracks[tid].missed += 1
                if self._tracks[tid].missed > max_missed:
                    self._archive_to_dormant(self._tracks[tid])
                    del self._tracks[tid]
            return

        self._expire_dormant_ttl()
        _, _, _, _, min_score = self._weights()
        min_dormant = float(os.environ.get("TRACK_DORMANT_MATCH_MIN_SCORE", "0.30"))
        min_dormant = max(0.05, min(0.95, min_dormant))
        feat_beta = self._feat_local_beta()

        used_i: set[int] = set()
        used_tid: set[int] = set()

        if self._tracks:
            pairs: list[tuple[float, int, int]] = []
            for i, row in enumerate(rows):
                for tid, tr in self._tracks.items():
                    pairs.append((self._pair_score(row, tr), i, tid))
            pairs.sort(key=lambda x: -x[0])
            for s, i, tid in pairs:
                if s < min_score:
                    break
                if i in used_i or tid in used_tid:
                    continue
                used_i.add(i)
                used_tid.add(tid)
                row = rows[i]
                tr = self._tracks[tid]
                gid = int(tr.global_gid)
                row["globalPersonId"] = gid
                row["_tid"] = tid
                gallery.touch_ema(gid, row["_feat"], feat_alt=row.get("_feat_alt"))
                tr.last_box = dict(row["box"])
                fu = _unit_vec(row["_feat"])
                tr.feat_ema = ((1.0 - feat_beta) * tr.feat_ema.astype(np.float64) + feat_beta * fu.astype(np.float64)).astype(
                    np.float32
                )
                fn = float(np.linalg.norm(tr.feat_ema)) + 1e-12
                tr.feat_ema = (tr.feat_ema / fn).astype(np.float32)
                tr.global_gid = gid
                tr.missed = 0

        fed_tid: set[int] = set(used_tid)

        d_pairs: list[tuple[float, int, int]] = []
        for i, row in enumerate(rows):
            if i in used_i:
                continue
            for j, dr in enumerate(self._dormant):
                d_pairs.append((self._dormant_pair_score(row, dr), i, j))
        d_pairs.sort(key=lambda x: -x[0])
        matched_dormant_idx: set[int] = set()
        for s, i, j in d_pairs:
            if s < min_dormant:
                break
            if i in used_i or j in matched_dormant_idx:
                continue
            used_i.add(i)
            matched_dormant_idx.add(j)
            row = rows[i]
            dr = self._dormant[j]
            gid = int(dr.global_gid)
            row["globalPersonId"] = gid
            gallery.touch_ema(gid, row["_feat"], feat_alt=row.get("_feat_alt"))
            fu = _unit_vec(row["_feat"])
            feat_ema = ((1.0 - feat_beta) * dr.feat_ema.astype(np.float64) + feat_beta * fu.astype(np.float64)).astype(np.float32)
            fn = float(np.linalg.norm(feat_ema)) + 1e-12
            feat_ema = (feat_ema / fn).astype(np.float32)
            tid = self._next_tid
            self._next_tid += 1
            self._tracks[tid] = _LocalTrack(
                tid=tid,
                last_box=dict(row["box"]),
                feat_ema=feat_ema,
                global_gid=gid,
                missed=0,
            )
            row["_tid"] = tid
            fed_tid.add(tid)

        if matched_dormant_idx:
            self._dormant = [d for k, d in enumerate(self._dormant) if k not in matched_dormant_idx]

        for i, row in enumerate(rows):
            if i in used_i:
                continue
            if row.get("_no_new_id"):
                # Crop too small/partial to create a reliable new ID.
                # Mark as weak (no globalPersonId), let output layer show as low-confidence box.
                row["globalPersonId"] = 0
                continue
            gid = gallery.match_or_create(row["_feat"], feat_alt=row.get("_feat_alt"),
                                         pose_vec=row.get("_pose_vec"))
            row["globalPersonId"] = gid
            fu = _unit_vec(row["_feat"])
            tid = self._next_tid
            self._next_tid += 1
            self._tracks[tid] = _LocalTrack(
                tid=tid,
                last_box=dict(row["box"]),
                feat_ema=fu,
                global_gid=int(gid),
                missed=0,
            )
            row["_tid"] = tid
            fed_tid.add(tid)

        for tid in list(self._tracks.keys()):
            if tid in fed_tid:
                continue
            self._tracks[tid].missed += 1
            if self._tracks[tid].missed > max_missed:
                self._archive_to_dormant(self._tracks[tid])
                del self._tracks[tid]

    def active_track_count(self) -> int:
        return len(self._tracks)

    def dormant_count(self) -> int:
        return len(self._dormant)

    def ingest_assigned_global_ids(self, rows: list[dict[str, Any]]) -> None:
        """
        global 阶段已为每框写好 globalPersonId 且已 match_or_create 进画廊。
        此处只做轨迹关联（IoU+外观+可选与 row 同 gid 加分），不调 match_or_create / touch_ema。
        """
        max_missed = self._max_missed()
        if not rows:
            for tid in list(self._tracks.keys()):
                self._tracks[tid].missed += 1
                if self._tracks[tid].missed > max_missed:
                    self._archive_to_dormant(self._tracks[tid])
                    del self._tracks[tid]
            return

        self._expire_dormant_ttl()
        _, _, _, _, min_score = self._weights()
        feat_beta = self._feat_local_beta()
        gid_bonus = float(os.environ.get("TRACK_SAME_GID_BONUS", "0.14"))
        gid_bonus = max(0.0, min(0.5, gid_bonus))

        used_i: set[int] = set()
        used_tid: set[int] = set()

        if self._tracks:
            pairs: list[tuple[float, int, int]] = []
            for i, row in enumerate(rows):
                rg = int(row.get("globalPersonId", 0))
                for tid, tr in self._tracks.items():
                    s = self._pair_score(row, tr)
                    if rg > 0 and int(tr.global_gid) == rg:
                        s += gid_bonus
                    pairs.append((s, i, tid))
            pairs.sort(key=lambda x: -x[0])
            for s, i, tid in pairs:
                if s < min_score:
                    break
                if i in used_i or tid in used_tid:
                    continue
                used_i.add(i)
                used_tid.add(tid)
                row = rows[i]
                tr = self._tracks[tid]
                gid = int(row["globalPersonId"])
                tr.global_gid = gid
                tr.last_box = dict(row["box"])
                row["_tid"] = tid
                fu = _unit_vec(row["_feat"])
                tr.feat_ema = ((1.0 - feat_beta) * tr.feat_ema.astype(np.float64) + feat_beta * fu.astype(np.float64)).astype(
                    np.float32
                )
                fn = float(np.linalg.norm(tr.feat_ema)) + 1e-12
                tr.feat_ema = (tr.feat_ema / fn).astype(np.float32)
                tr.missed = 0

        fed_tid: set[int] = set(used_tid)

        for i, row in enumerate(rows):
            if i in used_i:
                continue
            gid = int(row["globalPersonId"])
            fu = _unit_vec(row["_feat"])
            tid = self._next_tid
            self._next_tid += 1
            self._tracks[tid] = _LocalTrack(
                tid=tid,
                last_box=dict(row["box"]),
                feat_ema=fu,
                global_gid=gid,
                missed=0,
            )
            row["_tid"] = tid
            fed_tid.add(tid)

        for tid in list(self._tracks.keys()):
            if tid in fed_tid:
                continue
            self._tracks[tid].missed += 1
            if self._tracks[tid].missed > max_missed:
                self._archive_to_dormant(self._tracks[tid])
                del self._tracks[tid]

    def sync_gids_after_split(self, rows: list[dict[str, Any]]) -> None:
        """同帧 IoU 拆分可能 force_new_id 改 gid，把结果写回轨迹。"""
        for row in rows:
            tid = row.get("_tid")
            if tid is None or tid not in self._tracks:
                continue
            tr = self._tracks[tid]
            tr.global_gid = int(row["globalPersonId"])
            tr.last_box = dict(row["box"])
