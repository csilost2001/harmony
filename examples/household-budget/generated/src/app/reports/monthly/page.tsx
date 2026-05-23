'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

interface CategoryBreakdownItem {
  categoryName: string;
  categoryType: string;
  color: string;
  amount: number;
}

interface MonthlyReport {
  yearMonth: string;
  totalIncome: number;
  totalExpense: number;
  categoryBreakdown: CategoryBreakdownItem[];
}

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export default function MonthlyReportPage() {
  const router = useRouter();
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback((ym: string) => {
    setLoading(true);
    setError(null);
    apiFetch<MonthlyReport>(`/api/reports/monthly?yearMonth=${ym}`)
      .then((data) => setReport(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchReport(yearMonth);
  }, [router, yearMonth, fetchReport]);

  const balance = report ? report.totalIncome - report.totalExpense : 0;

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
          <h1 className="text-2xl font-bold text-gray-800">月次レポート</h1>
        </div>

        {/* Year-month selector */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex items-center gap-3">
          <label htmlFor="yearMonth" className="text-sm font-medium text-gray-600">
            対象月:
          </label>
          <input
            id="yearMonth"
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-400">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-red-500">{error}</p>
          </div>
        ) : report ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">収入合計</p>
                <p className="text-xl font-bold text-emerald-600">{formatCurrency(report.totalIncome)}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">支出合計</p>
                <p className="text-xl font-bold text-rose-500">{formatCurrency(report.totalExpense)}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">差引残高</p>
                <p className={`text-xl font-bold ${balance >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>
                  {formatCurrency(balance)}
                </p>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-base font-semibold text-gray-700 mb-4">カテゴリ別内訳</h2>
              {report.categoryBreakdown.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">
                  {yearMonth} の取引データがありません
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="pb-2">カテゴリ</th>
                      <th className="pb-2">種別</th>
                      <th className="pb-2 text-right">金額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {report.categoryBreakdown.map((item, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: item.color || '#94a3b8' }}
                            />
                            {item.categoryName}
                          </div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              item.categoryType === 'income'
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-rose-50 text-rose-500'
                            }`}
                          >
                            {item.categoryType === 'income' ? '収入' : '支出'}
                          </span>
                        </td>
                        <td className={`py-3 text-right font-semibold ${
                          item.categoryType === 'income' ? 'text-emerald-600' : 'text-rose-500'
                        }`}>
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
