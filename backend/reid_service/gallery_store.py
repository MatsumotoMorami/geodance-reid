from __future__ import annotations

import os

import numpy as np


class CosineGallery:
    """
    跨摄像头：余弦相似度匹配 global id。
    每人保留最多 K 条 L2 归一化原型（背面/侧面等多视角），匹配时取与 query 的 max cosine，
    缓解单向量 EMA 把多视角「平均糊掉」导致跨镜、跨角度对不上同一人的问题。
    """

    def __init__(self, *, threshold: float | None = None, ema: float | None = None) -> None:
        # 背面/侧面要并成一人：默认略低于纯正面场景；误并可提高 REID_MATCH_THRESHOLD
        t = threshold if threshold is not None else float(os.environ.get("REID_MATCH_THRESHOLD", "0.60"))
        self.threshold = max(0.0, min(0.999, t))
        self.ema = ema if ema is not None else float(os.environ.get("REID_GALLERY_EMA", "0.12"))
        self.min_margin = float(os.environ.get("REID_MIN_MARGIN", "0.03"))
        self.max_protos = int(os.environ.get("REID_PROTOTYPES_PER_PERSON", "5"))
        self.max_protos = max(1, min(16, self.max_protos))
        # 与当前人「最像的那条原型」相似度仍低于该值时，合并后追加新原型（新视角），而不是只 EMA 一条
        self.append_if_best_proto_below = float(os.environ.get("REID_APPEND_PROTO_IF_MAX_SIM_BELOW", "0.78"))
        self.append_if_best_proto_below = max(0.35, min(0.98, self.append_if_best_proto_below))
        self._protos: dict[int, list[np.ndarray]] = {}
        self._pose_store: dict[int, list[np.ndarray]] = {}
        self._next_id = 1

    @staticmethod
    def _norm_vec(v: np.ndarray) -> np.ndarray:
        x = v.reshape(-1).astype(np.float64)
        n = float(np.linalg.norm(x)) + 1e-12
        return (x / n).astype(np.float32)

    def _sim_qg(self, f: np.ndarray, f_alt: np.ndarray | None, g: np.ndarray) -> float:
        s0 = float(np.dot(f, g.astype(np.float64)))
        if f_alt is None:
            return s0
        return max(s0, float(np.dot(f_alt.astype(np.float64), g.astype(np.float64))))

    def _max_sim_to_id(self, f: np.ndarray, f_alt: np.ndarray | None, plist: list[np.ndarray]) -> float:
        return max(self._sim_qg(f, f_alt, p) for p in plist)

    def _rep_for_store(self, f: np.ndarray, f_alt: np.ndarray | None) -> np.ndarray:
        if f_alt is None:
            return f.astype(np.float32)
        u = f.astype(np.float64) + f_alt.astype(np.float64)
        u /= np.linalg.norm(u) + 1e-12
        return u.astype(np.float32)

    def _ema_merge_unit(self, old: np.ndarray, rep: np.ndarray) -> np.ndarray:
        merged = (1.0 - self.ema) * old.astype(np.float64) + self.ema * rep.astype(np.float64)
        merged /= float(np.linalg.norm(merged)) + 1e-12
        return merged.astype(np.float32)

    def _upsert_prototypes_after_merge(self, best_id: int, rep: np.ndarray, f: np.ndarray, f_alt: np.ndarray | None) -> None:
        plist = self._protos[best_id]
        sims = [self._sim_qg(f, f_alt, p) for p in plist]
        j = int(np.argmax(sims))
        sj = float(sims[j])
        if sj >= self.append_if_best_proto_below:
            plist[j] = self._ema_merge_unit(plist[j], rep)
        elif len(plist) < self.max_protos:
            plist.append(rep.astype(np.float32))
        else:
            plist[j] = self._ema_merge_unit(plist[j], rep)

    def _dynamic_threshold(self, gid: int) -> float:
        proto_count = len(self._protos.get(gid, []))
        singleton_extra = float(os.environ.get("REID_SINGLETON_EXTRA_SIM", "0.02"))
        multi_relax = float(os.environ.get("REID_MULTI_PROTO_RELAX", "0.04"))
        singleton_extra = max(0.0, min(0.20, singleton_extra))
        multi_relax = max(0.0, min(0.20, multi_relax))
        if proto_count <= 1:
            return min(0.999, self.threshold + singleton_extra)
        return max(0.0, self.threshold - multi_relax)

    def _remember_pose(self, gid: int, pose_vec: np.ndarray | None) -> None:
        if pose_vec is None or pose_vec.size <= 0:
            return
        store = self._pose_store.setdefault(gid, [])
        store.append(pose_vec.copy())
        cap = int(os.environ.get("REID_POSE_STORE_PER_ID", "5"))
        cap = max(1, min(20, cap))
        while len(store) > cap:
            store.pop(0)

    def _create_id(self, rep: np.ndarray, pose_vec: np.ndarray | None = None) -> int:
        gid = self._next_id
        self._next_id += 1
        self._protos[gid] = [rep.astype(np.float32)]
        self._remember_pose(gid, pose_vec)
        return gid

    def best_match_info(self, feat: np.ndarray, *, feat_alt: np.ndarray | None = None) -> tuple[int | None, float, float]:
        if not self._protos:
            return None, -1.0, -1.0
        f = self._norm_vec(feat)
        f_alt = self._norm_vec(feat_alt) if feat_alt is not None else None
        scored: list[tuple[int, float]] = [
            (gid, self._max_sim_to_id(f, f_alt, plist)) for gid, plist in self._protos.items()
        ]
        scored.sort(key=lambda x: -x[1])
        second_sim = scored[1][1] if len(scored) > 1 else -1.0
        return scored[0][0], float(scored[0][1]), float(second_sim)

    def match_or_create(self, feat: np.ndarray, *, feat_alt: np.ndarray | None = None,
                        pose_vec: np.ndarray | None = None, _debug_info: str = "") -> int:
        f = self._norm_vec(feat)
        f_alt = self._norm_vec(feat_alt) if feat_alt is not None else None
        rep = self._rep_for_store(f, f_alt)

        if not self._protos:
            gid = self._create_id(rep, pose_vec)
            self._log_match("NEW(first)", gid, -1, -1, -1, "empty gallery", _debug_info)
            return gid

        scored: list[tuple[int, float]] = [
            (gid, self._max_sim_to_id(f, f_alt, plist)) for gid, plist in self._protos.items()
        ]
        scored.sort(key=lambda x: -x[1])
        best_id, best_sim = scored[0]
        second_sim = scored[1][1] if len(scored) > 1 else -1.0
        margin = best_sim - second_sim
        dyn_threshold = self._dynamic_threshold(best_id)
        high_conf_sim = float(os.environ.get("REID_HIGH_CONF_MATCH_SIM", "0.72"))
        high_conf_sim = max(0.0, min(0.999, high_conf_sim))
        margin_ok = len(scored) == 1 or margin >= self.min_margin or best_sim >= high_conf_sim

        if best_sim >= dyn_threshold and margin_ok:
            # Pose consistency check: if poses are drastically different,
            # this is likely a different person despite similar appearance
            if pose_vec is not None and pose_vec.size > 0:
                if not self._pose_consistent(pose_vec, best_id):
                    self._log_match("REJECT(pose)", best_id, best_sim, second_sim,
                                    best_sim - second_sim,
                                    f"pose inconsistent, creating new ID",
                                    _debug_info)
                    gid = self._create_id(rep, pose_vec)
                    return gid

            self._upsert_prototypes_after_merge(best_id, rep, f, f_alt)
            self._remember_pose(best_id, pose_vec)
            self._log_match("MATCH", best_id, best_sim, second_sim, best_sim - second_sim,
                            f"thr={dyn_threshold:.3f} protos={len(self._protos[best_id])}",
                            _debug_info)
            return best_id

        gid = self._create_id(rep, pose_vec)
        reason = f"sim={best_sim:.4f} < thr={dyn_threshold:.3f} or margin={margin:.4f} < {self.min_margin:.3f}"
        self._log_match("NEW", gid, best_sim, second_sim, best_sim - second_sim, reason, _debug_info)
        return gid

    def _pose_consistent(self, pose_vec: np.ndarray, gid: int) -> bool:
        """Check if the query pose is roughly consistent with stored poses for this ID.
        For now, we store the pose within the prototype reference.
        Since prototypes store appearance vectors, we use a simple heuristic:
        store recent pose vectors per ID and compare.
        """
        if gid not in self._pose_store:
            self._pose_store[gid] = []
        stored = self._pose_store[gid]
        if not stored:
            return True
        # Check against stored poses
        from pose_feature import pose_similarity
        max_sim = max(pose_similarity(pose_vec, s) for s in stored)
        min_pose_sim = float(os.environ.get("REID_POSE_MIN_SIM", "0.35"))
        return max_sim >= min_pose_sim

    @staticmethod
    def _log_match(action: str, gid: int, best_sim: float, second_sim: float, margin: float,
                   reason: str, debug_info: str) -> None:
        if os.environ.get("REID_LOG_MATCHING", "").strip() not in ("1", "true", "yes", "on"):
            return
        import sys
        top3 = ""
        if action in ("NEW",):
            top3 = f" best_to={gid}"
        msg = (f"[REID] {action:5s} gid={gid:3d} best={best_sim:.4f} 2nd={second_sim:.4f} "
               f"margin={margin:.4f} | {reason} | {debug_info}{top3}")
        print(msg, file=sys.stderr, flush=True)

    def force_new_id(self, feat: np.ndarray, *, feat_alt: np.ndarray | None = None) -> int:
        f = self._norm_vec(feat)
        f_alt = self._norm_vec(feat_alt) if feat_alt is not None else None
        rep = self._rep_for_store(f, f_alt)
        return self._create_id(rep)

    def touch_ema(self, gid: int, feat: np.ndarray, *, feat_alt: np.ndarray | None = None) -> None:
        if gid not in self._protos:
            return
        f = self._norm_vec(feat)
        f_alt = self._norm_vec(feat_alt) if feat_alt is not None else None
        rep = self._rep_for_store(f, f_alt)
        plist = self._protos[gid]
        sims = [self._sim_qg(f, f_alt, p) for p in plist]
        j = int(np.argmax(sims))
        sj = float(sims[j])
        if sj >= 0.18:
            plist[j] = self._ema_merge_unit(plist[j], rep)
        elif len(plist) < self.max_protos:
            plist.append(rep.astype(np.float32))
        else:
            plist[j] = self._ema_merge_unit(plist[j], rep)

    def gallery_size(self) -> int:
        return len(self._protos)
