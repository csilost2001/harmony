import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CategoriesService } from './categories.service';

interface AuthRequest {
  user: { userId: number; login_id: string };
}

/**
 * CategoriesController
 *
 * Routes:
 *   GET /api/categories  — カテゴリ一覧取得
 */
@Controller('api/categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  async findAll(@Request() req: AuthRequest) {
    return this.categoriesService.findAll(req.user.userId);
  }
}
