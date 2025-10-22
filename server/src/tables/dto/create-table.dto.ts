import { IsArray, IsOptional, IsString, MaxLength, MinLength, IsEnum, IsObject } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateTableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsObject()
  metaJson?: any;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  exportAllowedRoles?: Role[];
}