import { IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTurnDto {
  @IsString()
  @IsNotEmpty()
  userInput!: string;

  @IsOptional()
  @IsString()
  turnContext?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  generateAudio?: boolean;
}
