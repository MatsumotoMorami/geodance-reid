import type { CameraDef } from "./cameras";

/** RTSP demuxer socket I/O 超时（微秒），低可用路略放宽 */
function rtspTimeoutUs(cam: CameraDef): string {
  return cam.tier === "low_availability" ? "20000000" : "12000000";
}

function vfChain(cam: CameraDef): string {
  if (cam.tier === "low_resolution") return "fps=12,scale=512:-2:flags=fast_bilinear";
  if (cam.tier === "low_availability") return "fps=10,scale=960:-2:flags=fast_bilinear";
  return "fps=15,scale=960:-2:flags=fast_bilinear";
}

/** 可选：videotoolbox / vaapi / cuda；空则不解锁，由 ffmpeg 自选 */
function hwAccelPrefix(): string[] {
  const h = process.env.RTSP_FFMPEG_HWACCEL?.trim();
  if (!h || h === "none" || h === "off") return [];
  return ["-hwaccel", h];
}

/**
 * 将单路 RTSP 转为 multipart MJPEG（stdout），供浏览器 <img> 或支持 mpjpeg 的播放器消费。
 * 需本机 PATH 中存在 ffmpeg。针对 HEVC 花帧：ignore_err、igndts、discardcorrupt、适当 probesize。
 */
export function buildRtspToMjpegArgs(cam: CameraDef): string[] {
  const timeout = rtspTimeoutUs(cam);
  const probe = process.env.RTSP_FFMPEG_PROBESIZE?.trim() || "10M";
  const analyze = process.env.RTSP_FFMPEG_ANALYZEDURATION?.trim() || "10M";
  const maxDelay = process.env.RTSP_FFMPEG_MAX_DELAY_US?.trim() || "8000000";

  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-err_detect",
    "ignore_err",
    ...hwAccelPrefix(),
    "-fflags",
    "nobuffer+genpts+igndts",
    "-skip_frame",
    "nokey",
    "-rtsp_transport",
    "tcp",
    "-timeout",
    timeout,
    "-max_delay",
    maxDelay,
    "-probesize",
    probe,
    "-analyzeduration",
    analyze,
    "-i",
    cam.rtspPath,
    "-an",
    "-vf",
    vfChain(cam),
    "-c:v",
    "mjpeg",
    "-q:v",
    process.env.RTSP_MJPEG_Q?.trim() || "6",
    "-f",
    "mpjpeg",
    "-",
  ];
}
