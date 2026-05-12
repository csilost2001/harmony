import { IsInt, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @IsNotEmpty()
  @IsInt()
  @Type(() => Number)
  storyId!: number;
}
