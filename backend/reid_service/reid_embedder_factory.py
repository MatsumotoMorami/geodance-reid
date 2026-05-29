"""按 REID_EMBED_BACKEND 选择 Re-ID 向量后端（fast-reid 或 torchreid OSNet 等）。"""

from __future__ import annotations

import os
from typing import Any

_embedder: Any | None = None


def get_embedder() -> Any:
    global _embedder
    if _embedder is not None:
        return _embedder
    backend = os.environ.get("REID_EMBED_BACKEND", "fastreid").strip().lower()
    if backend in ("torchreid", "torch-reid", "osnet"):
        from torchreid_embedder import TorchreidEmbedder

        _embedder = TorchreidEmbedder()
    else:
        from fastreid_embedder import FastReidEmbedder

        _embedder = FastReidEmbedder()
    return _embedder
