"""可选 Re-ID 后端：KaiyangZhou/torchreid + OSNet-AIN 等，对侧向/背面常比纯 Market1501-R50 更稳。"""

from __future__ import annotations

import os

import cv2
import numpy as np
import torch
import torch.nn.functional as F


class TorchreidEmbedder:
    """torchreid.utils.FeatureExtractor，输入 BGR 裁剪，输出 L2 归一化向量。"""

    def __init__(self) -> None:
        try:
            from torchreid.reid.utils import FeatureExtractor
        except ImportError:
            # Fallback for older torchreid versions
            try:
                from torchreid.utils import FeatureExtractor
            except ImportError as e:
                raise RuntimeError(
                    "REID_EMBED_BACKEND=torchreid 时需安装：pip install torchreid pillow"
                ) from e

        weights = os.environ.get("TORCHREID_WEIGHTS", "").strip()
        model_name = os.environ.get("TORCHREID_MODEL", "osnet_ain_x1_0").strip() or "osnet_ain_x1_0"
        device = os.environ.get("TORCHREID_DEVICE", os.environ.get("FASTREID_DEVICE", "cpu")).strip()
        if not weights or not os.path.isfile(weights):
            raise RuntimeError(
                "请设置 TORCHREID_WEIGHTS 为 .pth 或 .pth.tar 权重绝对路径。"
                "推荐 osnet_ain_x1_0 在 MSMT17 上训练的权重（见 "
                "https://kaiyangzhou.github.io/deep-person-reid/MODEL_ZOO.html ）"
            )

        self._extractor = FeatureExtractor(
            model_name=model_name,
            model_path=weights,
            device=device,
            verbose=False,
        )

    def embed_crop_bgr_mirror_pair(self, crop_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        rgb_f = cv2.flip(rgb, 1)
        ft = self._extractor([rgb, rgb_f])
        if not isinstance(ft, torch.Tensor):
            raise TypeError(f"torchreid FeatureExtractor 期望 Tensor，得到 {type(ft)}")
        if ft.dim() == 1:
            ft = ft.unsqueeze(0)
        ft = F.normalize(ft.float(), dim=1)
        a = ft[0].detach().cpu().numpy().astype(np.float32)
        b = ft[1].detach().cpu().numpy().astype(np.float32)
        return a, b

    def embed_crop_bgr(self, crop_bgr: np.ndarray) -> np.ndarray:
        if crop_bgr.size == 0:
            raise ValueError("empty crop")
        if os.environ.get("REID_TTA_HORIZONTAL", "1").strip().lower() in ("0", "false", "off", "no"):
            rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            ft = self._extractor(rgb)
            if not isinstance(ft, torch.Tensor):
                raise TypeError(f"torchreid FeatureExtractor 期望 Tensor，得到 {type(ft)}")
            if ft.dim() == 1:
                ft = ft.unsqueeze(0)
            ft = F.normalize(ft.float(), dim=1)
            return ft[0].detach().cpu().numpy().astype(np.float32)
        a, b = self.embed_crop_bgr_mirror_pair(crop_bgr)
        u = a.astype(np.float64) + b.astype(np.float64)
        u /= np.linalg.norm(u) + 1e-12
        return u.astype(np.float32)
