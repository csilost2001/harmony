import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '家計簿アプリ',
  description: '個人向け家計管理アプリ (household-budget sample)',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
