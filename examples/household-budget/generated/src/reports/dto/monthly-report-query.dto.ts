import { IsString, Matches } from 'class-validator';

/** 月次レポート取得クエリ DTO (process-flow: fetchMonthlyReport) */
export class MonthlyReportQueryDto {
  /** 対象月 (YYYY-MM 形式) */
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: '対象月の形式が不正です。YYYY-MM で指定してください。',
  })
  yearMonth!: string;
}
