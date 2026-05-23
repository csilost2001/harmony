import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 取引登録 (process-flow: createTransaction)
   * POST /api/transactions
   */
  async create(dto: CreateTransactionDto, sessionUserId: number) {
    const account = await this.prisma.account.findFirst({
      where: { id: dto.accountId, user_id: sessionUserId },
    });
    if (!account) {
      throw new UnprocessableEntityException(
        '指定された口座またはカテゴリが見つかりません。',
      );
    }

    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, user_id: sessionUserId },
    });
    if (!category) {
      throw new UnprocessableEntityException(
        '指定された口座またはカテゴリが見つかりません。',
      );
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        user_id: sessionUserId,
        account_id: dto.accountId,
        category_id: dto.categoryId,
        occurred_on: dto.occurredOn,
        amount: dto.amount,
        memo: dto.memo ?? null,
      },
    });

    return transaction;
  }

  /**
   * 取引一覧 (J3 取引一覧閲覧)
   * GET /api/transactions
   */
  async findAll(sessionUserId: number) {
    const rows = await this.prisma.$queryRawUnsafe<{
      id: number | bigint;
      occurredOn: string;
      amount: number | bigint | { toNumber(): number };
      memo: string | null;
      categoryId: number | bigint;
      categoryName: string;
      categoryType: string;
      categoryColor: string;
      accountId: number | bigint;
      accountName: string;
    }[]>(
      `SELECT
         t.id          AS id,
         t.occurred_on AS occurredOn,
         t.amount      AS amount,
         t.memo        AS memo,
         t.category_id AS categoryId,
         c.name        AS categoryName,
         c.category_type AS categoryType,
         c.color       AS categoryColor,
         t.account_id  AS accountId,
         a.name        AS accountName
       FROM "Transaction" t
       JOIN "Category" c ON c.id = t.category_id
       JOIN "Account"   a ON a.id = t.account_id
       WHERE t.user_id = ?
       ORDER BY t.occurred_on DESC, t.id DESC`,
      sessionUserId,
    );

    const toNumber = (v: number | bigint | { toNumber(): number }): number => {
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'object' && v !== null && typeof (v as { toNumber(): number }).toNumber === 'function') {
        return (v as { toNumber(): number }).toNumber();
      }
      return v as number;
    };

    return rows.map((row) => ({
      id: Number(row.id),
      occurredOn: row.occurredOn,
      amount: toNumber(row.amount),
      memo: row.memo,
      categoryId: Number(row.categoryId),
      categoryName: row.categoryName,
      categoryType: row.categoryType,
      categoryColor: row.categoryColor,
      accountId: Number(row.accountId),
      accountName: row.accountName,
    }));
  }

  /**
   * 取引削除 (process-flow: deleteTransaction)
   * DELETE /api/transactions/:transactionId
   */
  async remove(transactionId: number, sessionUserId: number) {
    // snapshot + 所有者チェック
    const snapshot = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user_id: sessionUserId },
    });
    if (!snapshot) {
      throw new NotFoundException('対象の取引が見つかりません。');
    }

    await this.prisma.transaction.delete({
      where: { id: transactionId },
    });

    // domain event: transaction.deleted (MVP: ログのみ)
    // subscriber: 監査ログ / 残高再計算 / undo 機能
  }

  /**
   * 取引単件取得 (process-flow: updateTransaction / act-load-transaction)
   * GET /api/transactions/:transactionId
   */
  async findOne(transactionId: number, sessionUserId: number) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user_id: sessionUserId },
    });
    if (!transaction) {
      throw new NotFoundException('対象の取引が見つかりません。');
    }
    return transaction;
  }

  /**
   * 取引更新 (process-flow: updateTransaction / act-update-transaction)
   * PUT /api/transactions/:transactionId
   */
  async update(
    transactionId: number,
    dto: UpdateTransactionDto,
    sessionUserId: number,
  ) {
    // 更新前 snapshot (所有者チェック兼用)
    const beforeSnapshot = await this.prisma.transaction.findFirst({
      where: { id: transactionId, user_id: sessionUserId },
    });
    if (!beforeSnapshot) {
      throw new NotFoundException('対象の取引が見つかりません。');
    }

    const updatedTransaction = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        account_id: dto.accountId,
        category_id: dto.categoryId,
        occurred_on: dto.occurredOn,
        amount: dto.amount,
        memo: dto.memo ?? null,
      },
    });

    // domain event: transaction.updated (MVP: ログのみ)
    // subscriber: 差分監査ログ

    return updatedTransaction;
  }
}
