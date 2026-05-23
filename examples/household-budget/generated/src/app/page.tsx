'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// TODO: Phase C (/generate-code for screen 3a000000-2000-4000-8000-000000000001) でダッシュボード実装を生成する
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">家計簿アプリ</h1>
        <p className="text-gray-500">ダッシュボードを読み込み中...</p>
      </div>
    </div>
  );
}
