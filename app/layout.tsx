import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoDance Re-ID Demo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
