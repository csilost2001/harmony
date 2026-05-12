import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedRequest extends Request {
  user: { userId: number; email: string };
}

@Controller('api/el/dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getDashboard(@Req() req: AuthenticatedRequest) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.userId } });
    const stories = await this.prisma.story.findMany({ where: { is_active: true }, take: 3 });
    return {
      streakDays: user?.streak_days ?? 0,
      cefrLevel: user?.cefr_level ?? 'A1',
      todayGoal: 3,
      todayDone: 0,
      recentStoryList: stories.map((s) => ({ id: s.id, title: s.title, cefrLevel: s.cefr_level })),
    };
  }
}
