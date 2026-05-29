"""与 Next 前端 lib/cameras.ts 一致的设备列表（RTSP）。"""

RTSP_HOST = "rtsp://geo.7sref.com:1989"

CAMERAS: list[dict[str, str]] = [
    {"id": "back_door", "url": f"{RTSP_HOST}/back_door"},
    # {"id": "stairs_1", "url": f"{RTSP_HOST}/stairs_1"},
    {"id": "maimai", "url": f"{RTSP_HOST}/maimai"},
    # {"id": "stairs_2", "url": f"{RTSP_HOST}/stairs_2"},
    {"id": "chuni", "url": f"{RTSP_HOST}/chuni"},
    {"id": "board_game", "url": f"{RTSP_HOST}/board_game"},
    # {"id": "iidx", "url": f"{RTSP_HOST}/iidx"},
    # {"id": "room", "url": f"{RTSP_HOST}/room"},
    # {"id": "mahjong", "url": f"{RTSP_HOST}/mahjong"},
]
