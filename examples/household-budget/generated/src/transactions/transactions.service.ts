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
