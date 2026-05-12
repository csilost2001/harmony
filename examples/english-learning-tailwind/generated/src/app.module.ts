import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { LearningSessionModule } from './learning-session/learning-session.module';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai-runtime.module';
import { ConversationTurnModule } from './conversation-turn/conversation-turn.module';

@Module({
  imports: [PrismaModule, AuthModule, LearningSessionModule, DashboardModule, AiModule, ConversationTurnModule],
})
export class AppModule {}
