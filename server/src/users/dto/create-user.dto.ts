import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsEnum(Role)
  role!: Role;
}