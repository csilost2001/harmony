import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 口座一覧取得 (ユーザー所有のもの) */
  async findAll(sessionUserId: number) {
    return this.prisma.account.findMany({
      where: { user_id: sessionUserId },
      orderBy: { created_at: 'asc' },
    });
  }
}
