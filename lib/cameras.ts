export type CameraTier = "normal" | "low_availability" | "low_resolution";

export type CameraDef = {
  id: string;
  label: string;
  rtspPath: string;
  tier: CameraTier;
};

/** 与 AGENTS.md 一致：rtsp://geo.7sref.com:1989/<device_name> */
const RTSP_HOST = "rtsp://geo.7sref.com:1989";

export const CAMERAS: CameraDef[] = [
  { id: "back_door", label: "back_door", rtspPath: `${RTSP_HOST}/back_door`, tier: "normal" },
  // { id: "stairs_1", label: "stairs_1", rtspPath: `${RTSP_HOST}/stairs_1`, tier: "low_availability" },
  { id: "maimai", label: "maimai", rtspPath: `${RTSP_HOST}/maimai`, tier: "normal" },
  // { id: "stairs_2", label: "stairs_2", rtspPath: `${RTSP_HOST}/stairs_2`, tier: "low_availability" },
  { id: "chuni", label: "chuni", rtspPath: `${RTSP_HOST}/chuni`, tier: "normal" },
  { id: "board_game", label: "board_game", rtspPath: `${RTSP_HOST}/board_game`, tier: "normal" },
  // { id: "iidx", label: "iidx", rtspPath: `${RTSP_HOST}/iidx`, tier: "low_resolution" },
  // { id: "room", label: "room", rtspPath: `${RTSP_HOST}/room`, tier: "normal" },
  // { id: "board_game", label: "board_game", rtspPath: `${RTSP_HOST}/board_game`, tier: "normal" },
  // { id: "mahjong", label: "mahjong", rtspPath: `${RTSP_HOST}/mahjong`, tier: "normal" },
];

export function getCameraById(id: string): CameraDef | undefined {
  return CAMERAS.find((c) => c.id === id);
}
