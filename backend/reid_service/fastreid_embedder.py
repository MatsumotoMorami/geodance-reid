from __future__ import annotations

import os
import sys
from typing import Any

import cv2
import numpy as np
import torch
import torch.nn.functional as F


def _ensure_fastreid_on_path() -> str:
    root = os.environ.get("FASTREID_ROOT", "").strip()
    if not root or not os.path.isdir(root):
        raise RuntimeError(
            "请设置环境变量 FASTREID_ROOT 为 fast-reid 仓库根目录（git clone https://github.com/JDAI-CV/fast-reid 后 pip install -e .）"
        )
    if root not in sys.path:
        sys.path.insert(0, root)
    return root


def _build_cfg() -> Any:
    _ensure_fastreid_on_path()
    from fastreid.config import get_cfg

    root = os.environ.get("FASTREID_ROOT", "").strip()
    default_cfg = os.path.join(root, "configs", "Market1501", "bagtricks_R50.yml")
    cfg_path = os.environ.get("FASTREID_CONFIG", default_cfg).strip()
    weights = os.environ.get("FASTREID_WEIGHTS", "").strip()
    if not weights or not os.path.isfile(weights):
        raise RuntimeError(
            "请设置 FASTREID_WEIGHTS 为 fast-reid 预训练权重 .pth 的绝对路径（见 https://github.com/JDAI-CV/fast-reid/blob/master/MODEL_ZOO.md ）"
        )
    device = os.environ.get("FASTREID_DEVICE", "cpu").strip()

    cfg = get_cfg()
    cfg.merge_from_file(cfg_path)
    cfg.defrost()
    cfg.MODEL.WEIGHTS = weights
    cfg.MODEL.DEVICE = device
    cfg.MODEL.BACKBONE.PRETRAIN = False
    if str(device).lower() == "cpu":
        try:
            cfg.SOLVER.AMP.ENABLED = False
        except Exception:
            pass
    cfg.freeze()
    return cfg


class FastReidEmbedder:
    """
    基于 fast-reid DefaultPredictor 的人体裁剪特征。
    支持水平翻转 TTA（REID_TTA_HORIZONTAL）与镜像对（供 REID_GALLERY_MAX_TTA 画廊匹配）。
    """

    def __init__(self) -> None:
        _ensure_fastreid_on_path()
        from fastreid.engine import DefaultPredictor

        self.cfg = _build_cfg()
        self.predictor = DefaultPredictor(self.cfg)

    def _tensor_from_rgb_u8(self, rgb_u8_hwc: np.ndarray) -> torch.Tensor:
        size_hw = tuple(self.cfg.INPUT.SIZE_TEST)
        img = cv2.resize(rgb_u8_hwc, size_hw[::-1], interpolation=cv2.INTER_CUBIC)
        return torch.as_tensor(img.astype("float32").transpose(2, 0, 1))

    @torch.no_grad()
    def _embed_rgb_batch_u8(self, rgbs: list[np.ndarray]) -> np.ndarray:
        """多张 RGB uint8 HWC，一次前向；返回 (N,D) L2 归一化 float32。"""
        if not rgbs:
            raise ValueError("empty batch")
        batched = torch.stack([self._tensor_from_rgb_u8(r) for r in rgbs], dim=0)
        raw = self.predictor(batched)
        if isinstance(raw, dict):
            feat_t = raw.get("features")
            if feat_t is None and "pred_features" in raw:
                feat_t = raw.get("pred_features")
            if not isinstance(feat_t, torch.Tensor):
                raise TypeError(f"unexpected predictor dict keys: {list(raw.keys())}")
        elif isinstance(raw, (tuple, list)) and len(raw) > 0 and isinstance(raw[0], torch.Tensor):
            feat_t = raw[0]
        else:
            feat_t = raw
        if not isinstance(feat_t, torch.Tensor):
            raise TypeError(f"unexpected predictor output type: {type(feat_t)}")
        if feat_t.dim() > 2:
            feat_t = feat_t.flatten(1)
        if feat_t.shape[0] != len(rgbs):
            raise RuntimeError(f"batch 大小不一致: feats {feat_t.shape[0]} vs N={len(rgbs)}")
        feat_t = F.normalize(feat_t, dim=-1)
        return feat_t.cpu().numpy().astype(np.float32)

    def embed_crop_bgr_mirror_pair(self, crop_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if crop_bgr.size == 0:
            raise ValueError("empty crop")
        rgb = crop_bgr[:, :, ::-1]
        mat = self._embed_rgb_batch_u8([rgb, cv2.flip(rgb, 1)])
        return mat[0].reshape(-1), mat[1].reshape(-1)

    @torch.no_grad()
    def embed_crop_bgr(self, crop_bgr: np.ndarray) -> np.ndarray:
        if crop_bgr.size == 0:
            raise ValueError("empty crop")
        rgb = crop_bgr[:, :, ::-1]
        if os.environ.get("REID_TTA_HORIZONTAL", "1").strip().lower() in ("0", "false", "off", "no"):
            mat = self._embed_rgb_batch_u8([rgb])
            return mat[0].reshape(-1)
        mat = self._embed_rgb_batch_u8([rgb, cv2.flip(rgb, 1)])
        u = mat[0].astype(np.float64) + mat[1].astype(np.float64)
        u /= np.linalg.norm(u) + 1e-12
        return u.astype(np.float32)
