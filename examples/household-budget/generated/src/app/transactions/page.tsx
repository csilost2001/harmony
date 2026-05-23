'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../lib/api';

interface TransactionRow {
  id: number;
  occurredOn: string;
  amount: number;
  memo: string | null;
  categoryId: number;
  categoryName: string;
  categoryType: string;
  categoryColor: string;
  accountId: number;
  accountName: string;
}

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    apiFetch<TransactionRow[]>('/api/transactions')
      .then((data) => setRows(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

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
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              ← ダッシュボード
            </button>
            <h1 className="text-2xl font-bold text-gray-800">取引一覧</h1>
          </div>
          <button
            onClick={() => router.push('/transactions/new')}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            + 新規取引
          </button>
        </div>

        {/* Transaction List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">取引がありません</p>
              <button
                onClick={() => router.push('/transactions/new')}
                className="mt-4 text-sm text-indigo-600 hover:underline"
              >
                最初の取引を追加する
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/transactions/${row.id}/edit`)}
                >
                  <div className="flex items-center gap-4">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: row.categoryColor || '#94a3b8' }}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{row.categoryName}</p>
                      <p className="text-xs text-gray-400">
                        {row.occurredOn} · {row.accountName}
                        {row.memo ? ` · ${row.memo}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold ${
                        row.categoryType === 'income' ? 'text-emerald-600' : 'text-rose-500'
                      }`}
                    >
                      {row.categoryType === 'income' ? '+' : '-'}
                      {formatCurrency(row.amount)}
                    </span>
                    <span className="text-gray-300 text-xs">›</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
