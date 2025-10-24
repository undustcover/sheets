import { IsArray, IsOptional, IsString, MaxLength, MinLength, IsEnum, IsObject, IsBoolean } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsObject()
  metaJson?: any;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  exportAllowedRoles?: Role[];

  @IsOptional()
  @IsBoolean()
  anonymousEnabled?: boolean;
}