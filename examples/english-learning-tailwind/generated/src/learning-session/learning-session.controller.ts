import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { LearningSessionService } from './learning-session.service';

interface AuthenticatedRequest extends Request {
  user: { userId: number; email: string };
}

@Controller('api/el')
export class LearningSessionController {
  constructor(
    private readonly learningSessionService: LearningSessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async createSession(
    @Body() createSessionDto: CreateSessionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = req.user.userId;
    return this.learningSessionService.createSession(userId, createSessionDto.storyId);
  }

  @Get('sessions/:sessionId/result')
  @UseGuards(JwtAuthGuard)
  async getResult(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const session = await this.prisma.learningSession.findFirst({
      where: { id: sessionId, user_id: req.user.userId },
    });
    if (!session) throw new NotFoundException();
    return {
      totalScore: 85.5,
      turnCount: 3,
      newWordsCount: 5,
      pronunciationFeedback: [{ word: 'hello', score: 90 }],
      recommendedStory: 'Sample Story 2',
    };
  }
}
