import {
  Controller,
  Post,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { ConversationTurnService } from './conversation-turn.service';
import { CreateTurnDto } from './dto/create-turn.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedRequest extends Request {
  user: { userId: number; email: string };
}

@Controller('api/el/sessions')
@UseGuards(JwtAuthGuard)
export class ConversationTurnController {
  constructor(private readonly conversationTurnService: ConversationTurnService) {}

  @Post(':sessionId/turns')
  @HttpCode(200)
  async createTurn(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Body() dto: CreateTurnDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conversationTurnService.processTurn(req.user.userId, sessionId, dto);
  }
}
