import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

interface AuthRequest {
  user: { userId: number; login_id: string };
}

/**
 * TransactionsController
 *
 * Routes (prefix: /api/transactions):
 *   GET    /api/transactions                    — listTransactions  (取引一覧、J3 要件)
 *   POST   /api/transactions                    — createTransaction (flow -000001)
 *   DELETE /api/transactions/:transactionId     — deleteTransaction (flow -000002)
 *   GET    /api/transactions/:transactionId     — loadTransaction   (flow -000004 act-load)
 *   PUT    /api/transactions/:transactionId     — updateTransaction  (flow -000004 act-update)
 */
@Controller('api/transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  /**
   * 取引一覧 (J3 取引一覧閲覧)
   * GET /api/transactions → 200 transaction[]
   */
  @Get()
  async findAll(@Request() req: AuthRequest) {
    return this.transactionsService.findAll(req.user.userId);
  }

  /**
   * 取引登録 (process-flow: createTransaction)
   * POST /api/transactions → 201
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateTransactionDto,
    @Request() req: AuthRequest,
  ) {
    return this.transactionsService.create(dto, req.user.userId);
  }

  /**
   * 取引削除 (process-flow: deleteTransaction)
   * DELETE /api/transactions/:transactionId → 204
   */
  @Delete(':transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Request() req: AuthRequest,
  ) {
    await this.transactionsService.remove(transactionId, req.user.userId);
  }

  /**
   * 取引単件取得 (process-flow: updateTransaction / act-load-transaction)
   * GET /api/transactions/:transactionId → 200
   */
  @Get(':transactionId')
  async findOne(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Request() req: AuthRequest,
  ) {
    return this.transactionsService.findOne(transactionId, req.user.userId);
  }

  /**
   * 取引更新 (process-flow: updateTransaction / act-update-transaction)
   * PUT /api/transactions/:transactionId → 200
   */
  @Put(':transactionId')
  async update(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Body() dto: UpdateTransactionDto,
    @Request() req: AuthRequest,
  ) {
    return this.transactionsService.update(transactionId, dto, req.user.userId);
  }
}
