import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  login_id!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
