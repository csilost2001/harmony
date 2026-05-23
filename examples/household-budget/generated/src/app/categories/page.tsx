'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface Category {
  id: number;
  name: string;
  category_type: string;
  icon: string | null;
  color: string;
}

export default function CategoriesPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    apiFetch<Category[]>('/api/categories')
      .then((data) => setCategories(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const incomeCategories = categories.filter((c) => c.category_type === 'income');
  const expenseCategories = categories.filter((c) => c.category_type === 'expense');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push('/')}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← ダッシュボード
          </button>
          <h1 className="text-2xl font-bold text-gray-800">カテゴリ管理</h1>
        </div>

        {/* Income Categories */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            収入カテゴリ ({incomeCategories.length})
          </h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
            {incomeCategories.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">収入カテゴリがありません</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {incomeCategories.map((cat) => (
                  <li key={cat.id} className="flex items-center gap-4 px-6 py-4">
                    <span
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: cat.color || '#94a3b8' }}
                    >
                      {cat.icon || cat.name.charAt(0)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{cat.name}</p>
                      <p className="text-xs text-emerald-500">収入</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Expense Categories */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            支出カテゴリ ({expenseCategories.length})
          </h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
            {expenseCategories.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">支出カテゴリがありません</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {expenseCategories.map((cat) => (
                  <li key={cat.id} className="flex items-center gap-4 px-6 py-4">
                    <span
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: cat.color || '#94a3b8' }}
                    >
                      {cat.icon || cat.name.charAt(0)}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{cat.name}</p>
                      <p className="text-xs text-rose-400">支出</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
