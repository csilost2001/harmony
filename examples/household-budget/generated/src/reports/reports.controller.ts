import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MonthlyReportQueryDto } from './dto/monthly-report-query.dto';
import { ReportsService } from './reports.service';

interface AuthRequest {
  user: { userId: number; login_id: string };
}

/**
 * ReportsController
 *
 * Routes:
 *   GET /api/reports/monthly?yearMonth=YYYY-MM  — fetchMonthlyReport (flow -000003)
 */
@Controller('api/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * 月次レポート取得 (process-flow: fetchMonthlyReport)
   * GET /api/reports/monthly?yearMonth=YYYY-MM → 200
   */
  @Get('monthly')
  async getMonthlyReport(
    @Query() query: MonthlyReportQueryDto,
    @Request() req: AuthRequest,
  ) {
    return this.reportsService.fetchMonthlyReport(query.yearMonth, req.user.userId);
  }
}
