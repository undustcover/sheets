import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FieldType } from '@prisma/client';

export class UpdateFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsEnum(FieldType)
  type?: FieldType;

  @IsOptional()
  @IsObject()
  optionsJson?: any;

  @IsOptional()
  @IsBoolean()
  readonly?: boolean;
}