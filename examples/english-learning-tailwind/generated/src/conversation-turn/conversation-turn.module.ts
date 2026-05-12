import { Module } from '@nestjs/common';
import { ConversationTurnController } from './conversation-turn.controller';
import { ConversationTurnService } from './conversation-turn.service';

@Module({
  controllers: [ConversationTurnController],
  providers: [ConversationTurnService],
})
export class ConversationTurnModule {}
