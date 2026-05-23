import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 取引更新 DTO (process-flow: updateTransaction) */
export class UpdateTransactionDto {
  /** 取引日 (YYYY-MM-DD) */
  @IsDateString()
  occurredOn!: string;

  /** 口座 ID */
  @IsInt()
  accountId!: number;

  /** カテゴリ ID */
  @IsInt()
  categoryId!: number;

  /** 金額 (1〜100,000,000) */
  @IsNumber()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  /** メモ (省略可、最大 200 文字) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  memo?: string;
}
