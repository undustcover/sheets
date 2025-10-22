import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CellWriteItemDto {
  @IsInt()
  @Min(1)
  recordId!: number;

  @IsInt()
  @Min(1)
  fieldId!: number;

  @IsOptional()
  value?: any;

  @IsOptional()
  @IsString()
  formulaExpr?: string;
}

export class BatchWriteDto {
  @IsInt()
  @Min(0)
  revision!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CellWriteItemDto)
  writes!: CellWriteItemDto[];
}