/** 归一化框 0~1，相对画面宽高 */
export type NormBox = { x: number; y: number; w: number; h: number };

export type Detection = {
  /**
   * 跨摄像头 Re-ID 编号（正数）。低置信度仅展示框为负数占位，不参与画廊。
   */
  globalPersonId: number;
  box: NormBox;
  /** YOLO 分数，低置信度框必有 */
  confidence?: number;
  /** 未过 YOLO_KEEP_MIN_CONF、未做 Re-ID，仅叠加画框 */
  lowConfidence?: boolean;
};

export type CameraFrame = {
  cameraId: string;
  online: boolean;
  detections: Detection[];
};

export type DetectionsDebugCamera = {
  cameraId: string;
  online: boolean;
  /** IoU 去重后的 YOLO person 数（进入置信度过滤前） */
  yoloPersons: number;
  /** IoU 去重前的 YOLO 原始框数 */
  yoloRawPersons?: number;
  /** 通过 YOLO_KEEP_MIN_CONF 后 */
  passedConf?: number;
  /** 通过裁剪最小边长后 */
  passedMinSide?: number;
  /** 通过宽高比/面积比例后 */
  passedShape?: number;
  /** 本路 Re-ID 主路径输出框数 */
  outputBoxes: number;
  /** 低置信度仅展示框数 */
  weakOutputBoxes?: number;
  embedFailures: number;
  /** 本路当前活跃轨迹条数（REID_PER_CAMERA_TRACK=1 时 Python 可选返回） */
  activeTracks?: number;
  /** 休眠轨迹条数（离开画面后仍保留外观与 global id，便于再入画识别） */
  dormantTracks?: number;
};

export type DemoPayload = {
  updatedAt: number;
  sampleIntervalMs: number;
  /** 本采样周期内：各路在线画面中出现的、跨镜 Re-ID 去重后的人数（当前在场） */
  visibleUniquePersonCount: number;
  /** Re-ID 画廊中已分配过的全局 id 数（历史累计，含已离开画面者） */
  galleryUniquePersonCount: number;
  frames: CameraFrame[];
  /** Python 在 DETECTIONS_STATS=1 时返回，用于排查「有流无框」 */
  stats?: { cameras: DetectionsDebugCamera[] };
  /** Next /api/detections 注入：当前数据来源 */
  clientSource?: "mock" | "reid";
};
