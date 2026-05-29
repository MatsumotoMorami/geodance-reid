import { spawn } from "child_process";
import type { NextRequest } from "next/server";
import { getCameraById } from "@/lib/cameras";
import { buildRtspToMjpegArgs } from "@/lib/rtspFfmpeg";
import { rtspDescribeStatusCode } from "@/lib/rtspDescribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 自托管长连接拉流；Serverless 平台不适合该路由 */
export const maxDuration = 3600;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.DISABLE_RTSP_PROXY === "1") {
    return new Response("RTSP proxy disabled (DISABLE_RTSP_PROXY=1)", { status: 503 });
  }

  const { id } = await ctx.params;
  const cam = getCameraById(id);
  if (!cam) {
    return new Response("Unknown camera id", { status: 404 });
  }

  const describeMs = Number.parseInt(process.env.RTSP_DESCRIBE_TIMEOUT_MS || "2500", 10);
  const describeCode = await rtspDescribeStatusCode(cam.rtspPath, describeMs);
  if (describeCode === 404) {
    return new Response("RTSP DESCRIBE 404（该路流不存在或路径错误）", { status: 404 });
  }

  const args = buildRtspToMjpegArgs(cam);
  const ff = spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (!ff.stdout) {
    return new Response("Failed to start ffmpeg (no stdout)", { status: 500 });
  }

  ff.stderr?.on("data", () => {});

  const kill = () => {
    try {
      ff.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  };

  const stdout = ff.stdout;

  /**
   * 不用 Readable.toWeb：在部分 Next 15 + Node 组合下，子进程 stdout 转 Web ReadableStream
   * 交给 Response 时可能出现首包后不再向下游转发，浏览器 <img> 一直空白。
   * 改为显式 enqueue，保证 MJPEG multipart 持续推送。
   */
  const webBody = new ReadableStream<Uint8Array>({
    start(controller) {
      ff.once("error", (err) => {
        try {
          controller.error(err);
        } catch {
          /* already closed */
        }
        kill();
      });

      const safeClose = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      stdout.on("data", (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          /* desiredSize / closed */
        }
      });
      stdout.once("end", safeClose);
      stdout.once("error", safeClose);
      ff.once("close", safeClose);
    },
    cancel() {
      kill();
    },
  });

  request.signal.addEventListener("abort", kill);
  ff.once("close", () => {
    try {
      request.signal.removeEventListener("abort", kill);
    } catch {
      /* ignore */
    }
  });

  return new Response(webBody, {
    status: 200,
    headers: {
      "Content-Type": "multipart/x-mixed-replace;boundary=ffmpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
