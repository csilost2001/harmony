import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toNumber } from '../lib/prisma-utils';

interface CategoryBreakdownRow {
  categoryName: string;
  categoryType: string;
  color: string;
  amount: number | bigint | { toNumber(): number };
}

interface TotalsRow {
  totalIncome: number | bigint | { toNumber(): number };
  totalExpense: number | bigint | { toNumber(): number };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 月次レポート取得 (process-flow: fetchMonthlyReport)
   * GET /api/reports/monthly?yearMonth=YYYY-MM
   */
  async fetchMonthlyReport(yearMonth: string, sessionUserId: number) {
    // step-02: カテゴリ別金額合計
    const categoryBreakdown = await this.prisma.$queryRawUnsafe<CategoryBreakdownRow[]>(
      `SELECT c.name AS categoryName, c.category_type AS categoryType, c.color AS color, SUM(t.amount) AS amount
       FROM "Transaction" t
       JOIN "Category" c ON c.id = t.category_id
       WHERE t.user_id = ? AND strftime('%Y-%m', t.occurred_on) = ?
       GROUP BY c.id, c.name, c.category_type, c.color
       ORDER BY amount DESC`,
      sessionUserId,
      yearMonth,
    );

    // step-03: 収入・支出合計
    const [totals] = await this.prisma.$queryRawUnsafe<TotalsRow[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN c.category_type = 'income'  THEN t.amount ELSE 0 END), 0) AS totalIncome,
         COALESCE(SUM(CASE WHEN c.category_type = 'expense' THEN t.amount ELSE 0 END), 0) AS totalExpense
       FROM "Transaction" t
       JOIN "Category" c ON c.id = t.category_id
       WHERE t.user_id = ? AND strftime('%Y-%m', t.occurred_on) = ?`,
      sessionUserId,
      yearMonth,
    );

    // step-04: report object に compose
    return {
      yearMonth,
      totalIncome: toNumber(totals?.totalIncome ?? 0),
      totalExpense: toNumber(totals?.totalExpense ?? 0),
      categoryBreakdown: categoryBreakdown.map((row) => ({
        categoryName: row.categoryName,
        categoryType: row.categoryType,
        color: row.color,
        amount: toNumber(row.amount),
      })),
    };
  }
}
