import {
  Controller,
  Post,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { ConversationTurnService } from './conversation-turn.service';
import { CreateTurnDto } from './dto/create-turn.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/el/sessions')
@UseGuards(JwtAuthGuard)
export class ConversationTurnController {
  constructor(private readonly conversationTurnService: ConversationTurnService) {}

  @Post(':sessionId/turns')
  @HttpCode(200)
  async createTurn(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() dto: CreateTurnDto,
    @Request() req: any,
  ) {
    return this.conversationTurnService.processTurn(req.user.userId, sessionId, dto);
  }
}
