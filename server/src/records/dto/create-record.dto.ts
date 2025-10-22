import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class CreateRecordDto {
  @IsOptional()
  @IsBoolean()
  readonly?: boolean;

  @IsOptional()
  @IsObject()
  metaJson?: Record<string, any>;

  // 键为 fieldId（字符串或数字），值为单元格值
  @IsObject()
  values!: Record<string, any>;

  // 公式字段可通过 formulas 提供表达式（键为 fieldId）
  @IsOptional()
  @IsObject()
  formulas?: Record<string, string>;
}