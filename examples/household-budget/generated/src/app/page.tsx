'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface Summary {
  monthlyIncome: number;
  monthlyExpense: number;
  balance: number;
}

interface TransactionRow {
  id: number;
  occurredOn: string;
  amount: number;
  memo: string | null;
  categoryName: string;
  categoryType: string;
  categoryColor: string;
  accountName: string;
}

interface DashboardData {
  summary: Summary;
  recentTransactionRows: TransactionRow[];
}

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    apiFetch<DashboardData>('/api/dashboard')
      .then((d) => setData(d))
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

  const summary = data?.summary ?? { monthlyIncome: 0, monthlyExpense: 0, balance: 0 };
  const rows = data?.recentTransactionRows ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 p-6">
      {/* Header */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-800">家計簿ダッシュボード</h1>
          <button
            onClick={() => router.push('/transactions/new')}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            + 取引を追加
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">今月の収入</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.monthlyIncome)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">今月の支出</p>
            <p className="text-2xl font-bold text-rose-500">{formatCurrency(summary.monthlyExpense)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">今月の収支</p>
            <p className={`text-2xl font-bold ${summary.balance >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
              {formatCurrency(summary.balance)}
            </p>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-700">直近の取引</h2>
            <button
              onClick={() => router.push('/transactions')}
              className="text-sm text-indigo-600 hover:underline"
            >
              全取引を見る
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">取引がありません</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between py-3 cursor-pointer hover:bg-gray-50 rounded-lg px-2 -mx-2"
                  onClick={() => router.push(`/transactions/${row.id}/edit`)}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: row.categoryColor || '#94a3b8' }}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{row.categoryName}</p>
                      <p className="text-xs text-gray-400">{row.occurredOn} · {row.accountName}</p>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      row.categoryType === 'income' ? 'text-emerald-600' : 'text-rose-500'
                    }`}
                  >
                    {row.categoryType === 'income' ? '+' : '-'}
                    {formatCurrency(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quick Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          {[
            { label: '取引一覧', href: '/transactions' },
            { label: '月次レポート', href: '/reports/monthly' },
            { label: 'カテゴリ管理', href: '/categories' },
          ].map((item) => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className="bg-white rounded-xl border border-gray-100 shadow-sm py-3 px-4 text-sm font-medium text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={() => {
              localStorage.removeItem('accessToken');
              router.push('/login');
            }}
            className="bg-white rounded-xl border border-gray-100 shadow-sm py-3 px-4 text-sm font-medium text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            ログアウト
          </button>
        </div>
      </div>
    </main>
  );
}
