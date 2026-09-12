/**
 * Bill Sequelize model — the core invoice table.
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';
import { BILL_TYPES, OCR_STATUSES } from '../../shared/constants.js';

export interface BillAttributes {
  billId: string;
  fleetId: string | null;
  vehicleId: string | null;
  billType: string;
  billCategory: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
  vendorId: string | null;
  companyName: string | null;
  gstin: string | null;
  pan: string | null;
  irn: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceTime: string | null;
  subtotalAmount: number | null;
  partsAmount: number | null;
  labourAmount: number | null;
  partsCgstAmount: number | null;
  partsSgstAmount: number | null;
  partsIgstAmount: number | null;
  partsCgstRate: number | null;
  partsSgstRate: number | null;
  partsIgstRate: number | null;
  labourCgstAmount: number | null;
  labourSgstAmount: number | null;
  labourIgstAmount: number | null;
  labourCgstRate: number | null;
  labourSgstRate: number | null;
  labourIgstRate: number | null;
  totalTaxAmount: number | null;
  grandTotalAmount: number | null;
  deductibles: number | null;
  salvage: number | null;
  odometerReading: number | null;
  registrationNumber: string | null;
  chassisNumber: string | null;
  ocrStatus: string;
  processingStatus: string | null;
  confidenceScore: number | null;
  reviewReasons: string[] | null;
  reviewCodes: string[] | null;
  totalReconciliation: Record<string, unknown> | null;
  fallbackAttempts: number | null;
  fallbackHistory: Record<string, unknown>[] | null;
  fileUrl: string | null;
  storagePath: string | null;
  rawOcrReference: string | null;
  parsedData: Record<string, unknown> | null;
  pipelineMode: string | null;
  extractionCostUsd: number | null;
  structuringCostUsd: number | null;
  totalCostUsd: number | null;
  extractionTokens: number | null;
  extractionInputTokens: number | null;
  extractionOutputTokens: number | null;
  structuringTokens: number | null;
  structuringInputTokens: number | null;
  structuringOutputTokens: number | null;
  totalTokens: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalThinkingTokens: number | null;
  totalInputCostUsd: number | null;
  totalOutputCostUsd: number | null;
  extractionProvider: string | null;
  structuringProvider: string | null;
  extractionModel: string | null;
  structuringModel: string | null;
  extractionLatencyMs: number | null;
  structuringLatencyMs: number | null;
  totalLatencyMs: number | null;
  extractionPages: number | null;
  inputRatePer1m: number | null;
  outputRatePer1m: number | null;
  fxRateUsdInr: number | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Bill extends Model<BillAttributes> implements BillAttributes {
  declare billId: string;
  declare fleetId: string | null;
  declare vehicleId: string | null;
  declare billType: string;
  declare billCategory: string | null;
  declare vendorName: string | null;
  declare vendorGstin: string | null;
  declare vendorId: string | null;
  declare companyName: string | null;
  declare gstin: string | null;
  declare pan: string | null;
  declare irn: string | null;
  declare invoiceNumber: string | null;
  declare invoiceDate: string | null;
  declare invoiceTime: string | null;
  declare subtotalAmount: number | null;
  declare partsAmount: number | null;
  declare labourAmount: number | null;
  declare partsCgstAmount: number | null;
  declare partsSgstAmount: number | null;
  declare partsIgstAmount: number | null;
  declare partsCgstRate: number | null;
  declare partsSgstRate: number | null;
  declare partsIgstRate: number | null;
  declare labourCgstAmount: number | null;
  declare labourSgstAmount: number | null;
  declare labourIgstAmount: number | null;
  declare labourCgstRate: number | null;
  declare labourSgstRate: number | null;
  declare labourIgstRate: number | null;
  declare totalTaxAmount: number | null;
  declare grandTotalAmount: number | null;
  declare deductibles: number | null;
  declare salvage: number | null;
  declare odometerReading: number | null;
  declare registrationNumber: string | null;
  declare chassisNumber: string | null;
  declare ocrStatus: string;
  declare processingStatus: string | null;
  declare confidenceScore: number | null;
  declare reviewReasons: string[] | null;
  declare reviewCodes: string[] | null;
  declare totalReconciliation: Record<string, unknown> | null;
  declare fallbackAttempts: number | null;
  declare fallbackHistory: Record<string, unknown>[] | null;
  declare fileUrl: string | null;
  declare storagePath: string | null;
  declare rawOcrReference: string | null;
  declare parsedData: Record<string, unknown> | null;
  declare pipelineMode: string | null;
  declare extractionCostUsd: number | null;
  declare structuringCostUsd: number | null;
  declare totalCostUsd: number | null;
  declare extractionTokens: number | null;
  declare extractionInputTokens: number | null;
  declare extractionOutputTokens: number | null;
  declare structuringTokens: number | null;
  declare structuringInputTokens: number | null;
  declare structuringOutputTokens: number | null;
  declare totalTokens: number | null;
  declare totalInputTokens: number | null;
  declare totalOutputTokens: number | null;
  declare totalThinkingTokens: number | null;
  declare totalInputCostUsd: number | null;
  declare totalOutputCostUsd: number | null;
  declare extractionProvider: string | null;
  declare structuringProvider: string | null;
  declare extractionModel: string | null;
  declare structuringModel: string | null;
  declare extractionLatencyMs: number | null;
  declare structuringLatencyMs: number | null;
  declare totalLatencyMs: number | null;
  declare extractionPages: number | null;
  declare inputRatePer1m: number | null;
  declare outputRatePer1m: number | null;
  declare fxRateUsdInr: number | null;
  declare schemaVersion: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initBillModel(seq: Sequelize): void {
  Bill.init({
    billId: { type: DataTypes.TEXT, primaryKey: true, field: 'bill_id' },
    fleetId: { type: DataTypes.TEXT, field: 'fleet_id' },
    vehicleId: { type: DataTypes.TEXT, field: 'vehicle_id' },
    billType: { type: DataTypes.TEXT, allowNull: false, field: 'bill_type', validate: { isIn: [BILL_TYPES] } },
    billCategory: { type: DataTypes.TEXT, field: 'bill_category' },
    vendorName: { type: DataTypes.TEXT, field: 'vendor_name' },
    vendorGstin: { type: DataTypes.TEXT, field: 'vendor_gstin' },
    vendorId: { type: DataTypes.TEXT, field: 'vendor_id', references: { model: 'vendors', key: 'vendor_id' }, onDelete: 'SET NULL' },
    companyName: { type: DataTypes.TEXT, field: 'company_name' },
    gstin: DataTypes.TEXT,
    pan: DataTypes.TEXT,
    irn: DataTypes.TEXT,
    invoiceNumber: { type: DataTypes.TEXT, field: 'invoice_number' },
    invoiceDate: { type: DataTypes.TEXT, field: 'invoice_date' },
    invoiceTime: { type: DataTypes.TEXT, field: 'invoice_time' },
    subtotalAmount: { type: DataTypes.DECIMAL(14, 2), field: 'subtotal_amount' },
    partsAmount: { type: DataTypes.DECIMAL(14, 2), field: 'parts_amount' },
    labourAmount: { type: DataTypes.DECIMAL(14, 2), field: 'labour_amount' },
    partsCgstAmount: { type: DataTypes.DECIMAL(14, 2), field: 'parts_cgst_amount' },
    partsSgstAmount: { type: DataTypes.DECIMAL(14, 2), field: 'parts_sgst_amount' },
    partsIgstAmount: { type: DataTypes.DECIMAL(14, 2), field: 'parts_igst_amount' },
    partsCgstRate: { type: DataTypes.DECIMAL(6, 3), field: 'parts_cgst_rate' },
    partsSgstRate: { type: DataTypes.DECIMAL(6, 3), field: 'parts_sgst_rate' },
    partsIgstRate: { type: DataTypes.DECIMAL(6, 3), field: 'parts_igst_rate' },
    labourCgstAmount: { type: DataTypes.DECIMAL(14, 2), field: 'labour_cgst_amount' },
    labourSgstAmount: { type: DataTypes.DECIMAL(14, 2), field: 'labour_sgst_amount' },
    labourIgstAmount: { type: DataTypes.DECIMAL(14, 2), field: 'labour_igst_amount' },
    labourCgstRate: { type: DataTypes.DECIMAL(6, 3), field: 'labour_cgst_rate' },
    labourSgstRate: { type: DataTypes.DECIMAL(6, 3), field: 'labour_sgst_rate' },
    labourIgstRate: { type: DataTypes.DECIMAL(6, 3), field: 'labour_igst_rate' },
    totalTaxAmount: { type: DataTypes.DECIMAL(14, 2), field: 'total_tax_amount' },
    grandTotalAmount: { type: DataTypes.DECIMAL(14, 2), field: 'grand_total_amount' },
    deductibles: { type: DataTypes.DECIMAL(14, 2) },
    salvage: { type: DataTypes.DECIMAL(14, 2) },
    odometerReading: { type: DataTypes.INTEGER, field: 'odometer_reading' },
    registrationNumber: { type: DataTypes.TEXT, field: 'registration_number' },
    chassisNumber: { type: DataTypes.TEXT, field: 'chassis_number' },
    ocrStatus: { type: DataTypes.TEXT, allowNull: false, field: 'ocr_status', validate: { isIn: [OCR_STATUSES] } },
    processingStatus: { type: DataTypes.TEXT, field: 'processing_status' },
    confidenceScore: { type: DataTypes.REAL, field: 'confidence_score' },
    reviewReasons: { type: DataTypes.ARRAY(DataTypes.TEXT), field: 'review_reasons' },
    reviewCodes: { type: DataTypes.ARRAY(DataTypes.TEXT), field: 'review_codes' },
    totalReconciliation: { type: DataTypes.JSONB, field: 'total_reconciliation' },
    fallbackAttempts: { type: DataTypes.INTEGER, field: 'fallback_attempts' },
    fallbackHistory: { type: DataTypes.JSONB, field: 'fallback_history' },
    fileUrl: { type: DataTypes.TEXT, field: 'file_url' },
    storagePath: { type: DataTypes.TEXT, field: 'storage_path' },
    rawOcrReference: { type: DataTypes.TEXT, field: 'raw_ocr_reference' },
    parsedData: { type: DataTypes.JSONB, field: 'parsed_data' },
    pipelineMode: { type: DataTypes.TEXT, field: 'pipeline_mode' },
    extractionCostUsd: { type: DataTypes.DECIMAL(18, 10), field: 'extraction_cost_usd' },
    structuringCostUsd: { type: DataTypes.DECIMAL(18, 10), field: 'structuring_cost_usd' },
    totalCostUsd: { type: DataTypes.DECIMAL(18, 10), field: 'total_cost_usd' },
    extractionTokens: { type: DataTypes.INTEGER, field: 'extraction_tokens' },
    extractionInputTokens: { type: DataTypes.INTEGER, field: 'extraction_input_tokens' },
    extractionOutputTokens: { type: DataTypes.INTEGER, field: 'extraction_output_tokens' },
    structuringTokens: { type: DataTypes.INTEGER, field: 'structuring_tokens' },
    structuringInputTokens: { type: DataTypes.INTEGER, field: 'structuring_input_tokens' },
    structuringOutputTokens: { type: DataTypes.INTEGER, field: 'structuring_output_tokens' },
    totalTokens: { type: DataTypes.INTEGER, field: 'total_tokens' },
    totalInputTokens: { type: DataTypes.INTEGER, field: 'total_input_tokens' },
    totalOutputTokens: { type: DataTypes.INTEGER, field: 'total_output_tokens' },
    totalThinkingTokens: { type: DataTypes.INTEGER, field: 'total_thinking_tokens' },
    totalInputCostUsd: { type: DataTypes.DECIMAL(18, 10), field: 'total_input_cost_usd' },
    totalOutputCostUsd: { type: DataTypes.DECIMAL(18, 10), field: 'total_output_cost_usd' },
    extractionProvider: { type: DataTypes.TEXT, field: 'extraction_provider' },
    structuringProvider: { type: DataTypes.TEXT, field: 'structuring_provider' },
    extractionModel: { type: DataTypes.TEXT, field: 'extraction_model' },
    structuringModel: { type: DataTypes.TEXT, field: 'structuring_model' },
    extractionLatencyMs: { type: DataTypes.INTEGER, field: 'extraction_latency_ms' },
    structuringLatencyMs: { type: DataTypes.INTEGER, field: 'structuring_latency_ms' },
    totalLatencyMs: { type: DataTypes.INTEGER, field: 'total_latency_ms' },
    extractionPages: { type: DataTypes.INTEGER, field: 'extraction_pages' },
    inputRatePer1m: { type: DataTypes.DECIMAL(18, 10), field: 'input_rate_per_1m' },
    outputRatePer1m: { type: DataTypes.DECIMAL(18, 10), field: 'output_rate_per_1m' },
    fxRateUsdInr: { type: DataTypes.DECIMAL(10, 4), field: 'fx_rate_usd_inr' },
    schemaVersion: { type: DataTypes.INTEGER, allowNull: false, field: 'schema_version' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
  }, {
    sequelize: seq, tableName: 'bills', timestamps: false,
    indexes: [
      { fields: [{ name: 'updated_at', order: 'DESC' }], name: 'bills_updated_at_idx' },
      { fields: [{ name: 'created_at', order: 'DESC' }], name: 'bills_created_at_idx' },
      { fields: ['ocr_status', { name: 'updated_at', order: 'DESC' }], name: 'bills_status_updated_idx' },
      { fields: ['vehicle_id'], name: 'bills_vehicle_idx' },
      { fields: ['vendor_id'], name: 'bills_vendor_idx' },
      { fields: ['invoice_number', 'vendor_gstin'], name: 'bills_dup_idx' },
    ],
  });
}
