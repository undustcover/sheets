import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { ViewType } from '@prisma/client';

export class CreateViewDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsEnum(ViewType)
  type!: ViewType;

  @IsOptional()
  @IsObject()
  configJson?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  anonymousEnabled?: boolean;
}