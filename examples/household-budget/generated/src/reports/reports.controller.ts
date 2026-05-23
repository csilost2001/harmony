import { BadRequestException, Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
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
    const pattern = /^\d{4}-(0[1-9]|1[0-2])$/;
    if (!query.yearMonth || !pattern.test(query.yearMonth)) {
      throw new BadRequestException(
        '対象月の形式が不正です。YYYY-MM で指定してください。',
      );
    }
    return this.reportsService.fetchMonthlyReport(query.yearMonth, req.user.userId);
  }
}
