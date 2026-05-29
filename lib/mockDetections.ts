import { CAMERAS } from "./cameras";
import type { CameraFrame, DemoPayload, Detection, NormBox } from "./types";

/** 模拟：若干「真实人」在哪些摄像头里同时出现（跨镜 Re-ID 同源） */
type SimPerson = {
  globalId: number;
  /** cameraId -> 归一化框（可随 tick 微动） */
  appearances: Record<string, NormBox>;
};

const BASE_PEOPLE: SimPerson[] = [
  {
    globalId: 1,
    appearances: {
      back_door: { x: 0.12, y: 0.18, w: 0.22, h: 0.62 },
      maimai: { x: 0.55, y: 0.2, w: 0.18, h: 0.55 },
    },
  },
  {
    globalId: 2,
    appearances: {
      room: { x: 0.3, y: 0.25, w: 0.25, h: 0.5 },
      board_game: { x: 0.4, y: 0.22, w: 0.2, h: 0.48 },
    },
  },
  {
    globalId: 3,
    appearances: {
      chuni: { x: 0.2, y: 0.3, w: 0.28, h: 0.45 },
      mahjong: { x: 0.5, y: 0.28, w: 0.24, h: 0.5 },
    },
  },
  {
    globalId: 4,
    appearances: {
      iidx: { x: 0.35, y: 0.35, w: 0.3, h: 0.4 },
    },
  },
];

function jitter(box: NormBox, seed: number, amp: number): NormBox {
  const jx = Math.sin(seed * 0.7) * amp;
  const jy = Math.cos(seed * 0.5) * amp;
  return {
    x: Math.min(0.85, Math.max(0.02, box.x + jx)),
    y: Math.min(0.8, Math.max(0.02, box.y + jy)),
    w: box.w,
    h: box.h,
  };
}

export function buildDemoPayload(tick: number): DemoPayload {
  const frames: CameraFrame[] = [];

  for (const cam of CAMERAS) {
    const dets: Detection[] = [];
    for (const p of BASE_PEOPLE) {
      const raw = p.appearances[cam.id];
      if (!raw) continue;
      dets.push({
        globalPersonId: p.globalId,
        box: jitter(raw, tick + p.globalId * 3, 0.02),
      });
    }
    frames.push({ cameraId: cam.id, online: true, detections: dets });
  }

  const visibleIds = new Set<number>();
  for (const f of frames) {
    for (const d of f.detections) visibleIds.add(d.globalPersonId);
  }

  const galleryIds = new Set(BASE_PEOPLE.map((p) => p.globalId));

  const stats = {
    cameras: CAMERAS.map((c) => {
      const f = frames.find((fr) => fr.cameraId === c.id);
      const n = f?.detections.length ?? 0;
      return {
        cameraId: c.id,
        online: true,
        yoloRawPersons: n,
        yoloPersons: n,
        passedConf: n,
        passedMinSide: n,
        passedShape: n,
        outputBoxes: n,
        weakOutputBoxes: 0,
        embedFailures: 0,
      };
    }),
  };

  return {
    updatedAt: Date.now(),
    sampleIntervalMs: 3000,
    galleryUniquePersonCount: galleryIds.size,
    visibleUniquePersonCount: visibleIds.size,
    frames,
    stats,
    clientSource: "mock" as const,
  };
}
