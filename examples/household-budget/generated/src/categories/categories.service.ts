import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** カテゴリ一覧取得 (ユーザー所有のもの) */
  async findAll(sessionUserId: number) {
    return this.prisma.category.findMany({
      where: { user_id: sessionUserId },
      orderBy: { name: 'asc' },
    });
  }
}
