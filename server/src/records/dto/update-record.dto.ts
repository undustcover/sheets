import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class UpdateRecordDto {
  @IsOptional()
  @IsBoolean()
  readonly?: boolean;

  @IsOptional()
  @IsObject()
  metaJson?: Record<string, any>;

  // 可选：更新单元格值（键为 fieldId）
  @IsOptional()
  @IsObject()
  values?: Record<string, any>;

  // 可选：更新公式表达式（键为 fieldId）
  @IsOptional()
  @IsObject()
  formulas?: Record<string, string>;
}