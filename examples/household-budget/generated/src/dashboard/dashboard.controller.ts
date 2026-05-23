import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

interface AuthRequest {
  user: { userId: number; login_id: string };
}

/**
 * DashboardController
 *
 * Routes:
 *   GET /api/dashboard  — fetchDashboardData (flow -000005)
 */
@Controller('api/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * ダッシュボードデータ取得 (process-flow: fetchDashboardData)
   * GET /api/dashboard → 200
   */
  @Get()
  async getDashboardData(@Request() req: AuthRequest) {
    return this.dashboardService.fetchDashboardData(req.user.userId);
  }
}
