/**
 * AppSettings Sequelize model — singleton row (id=1).
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export interface AppSettingsAttributes {
  id: number;
  pipelineMode: string;
  extractionProvider: string;
  structuringProvider: string;
  structuringModel: string;
  extractionModel: string | null;
  singleProvider: string | null;
  singleModel: string | null;
  compareProvider: string | null;
  compareModel: string | null;
  emailIntakeEnabled: boolean | null;
  emailIntakeUser: string | null;
  emailIntakePollIntervalSec: number | null;
  emailIntakeAllowedSenders: string[] | null;
  modelPricing: Record<string, unknown> | null;
  fallbackChain: Record<string, unknown>[] | null;
  usdToInr: number | null;
  thinkingBudget: number | null;
  mistralOcrPricePer1kPages: number | null;
}

export class AppSettingsModel extends Model<AppSettingsAttributes> implements AppSettingsAttributes {
  declare id: number;
  declare pipelineMode: string;
  declare extractionProvider: string;
  declare structuringProvider: string;
  declare structuringModel: string;
  declare extractionModel: string | null;
  declare singleProvider: string | null;
  declare singleModel: string | null;
  declare compareProvider: string | null;
  declare compareModel: string | null;
  declare emailIntakeEnabled: boolean | null;
  declare emailIntakeUser: string | null;
  declare emailIntakePollIntervalSec: number | null;
  declare emailIntakeAllowedSenders: string[] | null;
  declare modelPricing: Record<string, unknown> | null;
  declare fallbackChain: Record<string, unknown>[] | null;
  declare usdToInr: number | null;
  declare thinkingBudget: number | null;
  declare mistralOcrPricePer1kPages: number | null;
}

export function initAppSettingsModel(seq: Sequelize): void {
  AppSettingsModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    pipelineMode: { type: DataTypes.TEXT, allowNull: false, field: 'pipeline_mode' },
    extractionProvider: { type: DataTypes.TEXT, allowNull: false, field: 'extraction_provider' },
    structuringProvider: { type: DataTypes.TEXT, allowNull: false, field: 'structuring_provider' },
    structuringModel: { type: DataTypes.TEXT, allowNull: false, field: 'structuring_model' },
    extractionModel: { type: DataTypes.TEXT, field: 'extraction_model' },
    singleProvider: { type: DataTypes.TEXT, field: 'single_provider' },
    singleModel: { type: DataTypes.TEXT, field: 'single_model' },
    compareProvider: { type: DataTypes.TEXT, field: 'compare_provider' },
    compareModel: { type: DataTypes.TEXT, field: 'compare_model' },
    emailIntakeEnabled: { type: DataTypes.BOOLEAN, field: 'email_intake_enabled' },
    emailIntakeUser: { type: DataTypes.TEXT, field: 'email_intake_user' },
    emailIntakePollIntervalSec: { type: DataTypes.INTEGER, field: 'email_intake_poll_interval_sec' },
    emailIntakeAllowedSenders: { type: DataTypes.ARRAY(DataTypes.TEXT), field: 'email_intake_allowed_senders' },
    modelPricing: { type: DataTypes.JSONB, field: 'model_pricing' },
    fallbackChain: { type: DataTypes.JSONB, field: 'fallback_chain' },
    usdToInr: { type: DataTypes.DECIMAL(10, 4), field: 'usd_to_inr' },
    thinkingBudget: { type: DataTypes.INTEGER, field: 'thinking_budget' },
    mistralOcrPricePer1kPages: { type: DataTypes.DECIMAL(10, 4), field: 'mistral_ocr_price_per_1k_pages' },
  }, {
    sequelize: seq, tableName: 'app_settings', timestamps: false,
  });
}
