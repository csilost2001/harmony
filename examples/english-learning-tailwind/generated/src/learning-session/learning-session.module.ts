import { Module } from '@nestjs/common';
import { LearningSessionController } from './learning-session.controller';
import { LearningSessionService } from './learning-session.service';

@Module({
  controllers: [LearningSessionController],
  providers: [LearningSessionService],
})
export class LearningSessionModule {}
