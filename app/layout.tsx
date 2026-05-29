import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoDance Re-ID Demo",
  description: "多路 RTSP + 跟踪 + 跨镜 Re-ID（演示）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
