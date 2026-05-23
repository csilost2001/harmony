'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';

interface Account {
  id: number;
  name: string;
}

interface Category {
  id: number;
  name: string;
  category_type: string;
  color: string;
}

interface Transaction {
  id: number;
  occurred_on: string;
  amount: number;
  memo: string | null;
  account_id: number;
  category_id: number;
}

export default function TransactionEditPage() {
  const router = useRouter();
  const params = useParams<{ transactionId: string }>();
  const transactionId = params?.transactionId;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [occurredOn, setOccurredOn] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!transactionId) return;

    Promise.all([
      apiFetch<Transaction>(`/api/transactions/${transactionId}`),
      apiFetch<Account[]>('/api/accounts'),
      apiFetch<Category[]>('/api/categories'),
    ])
      .then(([tx, accs, cats]) => {
        setOccurredOn(tx.occurred_on);
        setAccountId(String(tx.account_id));
        setCategoryId(String(tx.category_id));
        setAmount(String(tx.amount));
        setMemo(tx.memo ?? '');
        setAccounts(accs);
        setCategories(cats);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router, transactionId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/api/transactions/${transactionId}`, {
        method: 'PUT',
        body: JSON.stringify({
          occurredOn,
          accountId: Number(accountId),
          categoryId: Number(categoryId),
          amount: Number(amount),
          memo: memo || null,
        }),
      });
      router.push('/transactions');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm('この取引を削除しますか？')) return;
    setError(null);
    setDeleting(true);
    try {
      await apiFetch(`/api/transactions/${transactionId}`, {
        method: 'DELETE',
      });
      router.push('/transactions');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (error && !occurredOn) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-slate-100 p-6">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push('/transactions')}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← 取引一覧
          </button>
          <h1 className="text-2xl font-bold text-gray-800">取引編集</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 取引日 */}
            <div>
              <label htmlFor="occurredOn" className="block text-sm font-medium text-gray-700 mb-1">
                取引日 <span className="text-rose-500">*</span>
              </label>
              <input
                id="occurredOn"
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* 口座 */}
            <div>
              <label htmlFor="accountId" className="block text-sm font-medium text-gray-700 mb-1">
                口座 <span className="text-rose-500">*</span>
              </label>
              <select
                id="accountId"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* カテゴリ */}
            <div>
              <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 mb-1">
                カテゴリ <span className="text-rose-500">*</span>
              </label>
              <select
                id="categoryId"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.category_type === 'income' ? '収入' : '支出'})
                  </option>
                ))}
              </select>
            </div>

            {/* 金額 */}
            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
                金額 <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">¥</span>
                <input
                  id="amount"
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* メモ */}
            <div>
              <label htmlFor="memo" className="block text-sm font-medium text-gray-700 mb-1">
                メモ
              </label>
              <input
                id="memo"
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="任意"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {error && <p className="text-rose-500 text-sm">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting || deleting}
                className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 transition-colors"
              >
                {submitting ? '更新中...' : '更新する'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting || deleting}
                className="py-2.5 px-4 bg-rose-50 text-rose-600 rounded-lg text-sm font-medium hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:opacity-50 transition-colors"
              >
                {deleting ? '削除中...' : '削除'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
