import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 多路长时间 MJPEG 会拖住 dev 旧编译；Webpack 热更新重编号 chunk 后，
   * webpack-runtime 仍 require 旧数字 chunk（如 ./873.js）即报错。
   * dev 下使用 named id，并配合前端错开拉流，可明显降低该竞态。
   */
  webpack: (config, { dev }) => {
    if (dev) {
      config.optimization = {
        ...config.optimization,
        moduleIds: "named",
        chunkIds: "named",
      };
    }
    return config;
  },
};

export default nextConfig;
