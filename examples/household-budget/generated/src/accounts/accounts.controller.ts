import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountsService } from './accounts.service';

interface AuthRequest {
  user: { userId: number; login_id: string };
}

/**
 * AccountsController
 *
 * Routes:
 *   GET /api/accounts  — 口座一覧取得
 */
@Controller('api/accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async findAll(@Request() req: AuthRequest) {
    return this.accountsService.findAll(req.user.userId);
  }
}
