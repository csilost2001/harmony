import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface MonthlyTotalsRow {
  monthlyIncome: number | bigint | { toNumber(): number };
  monthlyExpense: number | bigint | { toNumber(): number };
}

interface RecentTransactionRow {
  id: number | bigint;
  occurredOn: string;
  amount: number | bigint | { toNumber(): number };
  memo: string | null;
  categoryName: string;
  categoryType: string;
  categoryColor: string;
  accountName: string;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ダッシュボードデータ取得 (process-flow: fetchDashboardData)
   * GET /api/dashboard
   */
  async fetchDashboardData(sessionUserId: number) {
    // step-01: 当月の収入/支出合計
    const [monthlyTotals] = await this.prisma.$queryRawUnsafe<MonthlyTotalsRow[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN c.category_type = 'income'  THEN t.amount ELSE 0 END), 0) AS monthlyIncome,
         COALESCE(SUM(CASE WHEN c.category_type = 'expense' THEN t.amount ELSE 0 END), 0) AS monthlyExpense
       FROM "Transaction" t
       JOIN "Category" c ON c.id = t.category_id
       WHERE t.user_id = ?
         AND strftime('%Y-%m', t.occurred_on) = strftime('%Y-%m', 'now', 'localtime')`,
      sessionUserId,
    );

    // step-02: 直近 5 件の取引 (JOIN 済 display 用 shape)
    const recentTransactionRows = await this.prisma.$queryRawUnsafe<RecentTransactionRow[]>(
      `SELECT
         t.id AS id,
         t.occurred_on AS occurredOn,
         t.amount AS amount,
         t.memo AS memo,
         c.name AS categoryName,
         c.category_type AS categoryType,
         c.color AS categoryColor,
         a.name AS accountName
       FROM "Transaction" t
       JOIN "Category" c ON c.id = t.category_id
       JOIN "Account" a ON a.id = t.account_id
       WHERE t.user_id = ?
       ORDER BY t.occurred_on DESC, t.id DESC
       LIMIT 5`,
      sessionUserId,
    );

    const toNumber = (v: number | bigint | { toNumber(): number }): number => {
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'object' && v !== null && typeof (v as { toNumber(): number }).toNumber === 'function') {
        return (v as { toNumber(): number }).toNumber();
      }
      return v as number;
    };

    const monthlyIncome = toNumber(monthlyTotals?.monthlyIncome ?? 0);
    const monthlyExpense = toNumber(monthlyTotals?.monthlyExpense ?? 0);

    // step-03: summary object に compose
    const summary = {
      monthlyIncome,
      monthlyExpense,
      balance: monthlyIncome - monthlyExpense,
    };

    // step-04: summary + recentTransactionRows を返却
    return {
      summary,
      recentTransactionRows: recentTransactionRows.map((row) => ({
        id: Number(row.id),
        occurredOn: row.occurredOn,
        amount: toNumber(row.amount),
        memo: row.memo,
        categoryName: row.categoryName,
        categoryType: row.categoryType,
        categoryColor: row.categoryColor,
        accountName: row.accountName,
      })),
    };
  }
}
