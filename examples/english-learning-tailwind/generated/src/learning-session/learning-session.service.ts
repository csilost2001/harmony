import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LearningSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(userId: number, storyId: number): Promise<{ sessionId: number }> {
    // step-01: stories SELECT (validate: is_active=TRUE)
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, is_active: true },
    });

    if (!story) {
      throw new NotFoundException(`Story with id ${storyId} not found or not active`);
    }

    // step-02: learning_sessions INSERT
    const session = await this.prisma.learningSession.create({
      data: {
        user_id: userId,
        story_id: storyId,
        status: 'in_progress',
      },
    });

    // step-03: return 201 with sessionId
    return { sessionId: session.id };
  }
}
