import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "リテール総合",
  description: "Harmony pl-7 generated Next.js + Tailwind demo (PageLayout + Gadget)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
