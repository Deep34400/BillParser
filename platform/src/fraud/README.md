# Fraud Detection Module

Automated checks that scan all completed invoices for anomalies, duplicates, and suspicious patterns. All checks are stateless — they run on demand and return alerts without persisting anything.

## How It Works — Full Flow

### What Happens When You Scan

```
User clicks "Run Fraud Scan" in the UI
  → Frontend calls GET /api/fraud/scan
  → route.ts calls service.ts → runAllChecks()
  → runAllChecks() runs all 4 detection algorithms in parallel
  → Each algorithm reads bills from Firestore, applies its rules
  → Returns a combined list of FraudAlert objects
  → UI groups alerts by type and severity for review
```

### Detection Algorithms

#### 1. Duplicate Invoice Detection (`detectDuplicateInvoices`)

**How it works:**
1. Fetches all completed bills from Firestore
2. Groups bills by a key: `{invoice_number}__{vendor_gstin}`
3. If any group has 2+ bills → that's a duplicate
4. Returns a HIGH severity alert with the invoice number, vendor name, and amounts

**What it catches:** Same invoice uploaded or processed multiple times. The vendor GSTIN is included in the key so invoices with the same number from different vendors don't false-positive.

#### 2. GST Anomaly Detection (`detectGstAnomalies`)

**How it works:**
1. For each completed bill, extracts the GST data (rates and amounts) for both parts and labour sides
2. Validates each side against Indian GST rules:
   - CGST rate must equal SGST rate (intra-state)
   - IGST is mutually exclusive with CGST+SGST (inter-state)
   - Tax amount must match: `taxable_base × rate%` (within ₹1 or 1% tolerance)
   - `taxable_base = gross_amount − discount` (GST is charged AFTER discount)
3. Checks if GSTIN format is valid (15-char alphanumeric pattern)
4. Returns MEDIUM-HIGH severity alerts for each discrepancy

**What it catches:** Fake GSTINs, incorrect tax calculations, mismatched CGST/SGST amounts, tax charged before discount.

#### 3. Price Anomaly Detection (`detectPriceAnomalies`)

**How it works:**
1. Fetches all bill parts (line items) from the `bill_parts` collection
2. Groups parts by their name/description
3. For each group with 3+ entries, calculates the average unit price
4. Flags any part whose unit price is >3× the average
5. Returns MEDIUM severity alerts

**What it catches:** Inflated prices on commonly purchased items. For example, if "Oil Filter" averages ₹250 across invoices but one bill charges ₹800, it gets flagged.

#### 4. Odometer Inconsistency (`detectOdometerInconsistency`)

**How it works:**
1. Groups all bills by vehicle (using registration number)
2. Sorts each vehicle's bills by date
3. Checks consecutive bills for:
   - Odometer going backwards (current reading < previous reading)
   - Suspiciously large jumps (>50,000 km between services)
4. Returns MEDIUM severity alerts

**What it catches:** Odometer tampering or rollback, data entry errors, vehicles being serviced suspiciously far from their last service.

### Alert Structure

Every alert returned by any check has the same shape:

```
{
  type: "DUPLICATE_INVOICE" | "GST_ANOMALY" | "PRICE_ANOMALY" | "ODOMETER_INCONSISTENCY",
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  message: "Human-readable description of what was found",
  bill_ids: ["id1", "id2"],    // which invoices are involved
  details: { ... }              // algorithm-specific context
}
```

Alerts are advisory only — they never modify invoices or block processing.

## File Reference

| File | What it does |
|------|-------------|
| `route.ts` | HTTP endpoints — one per check type + combined scan |
| `service.ts` | Detection algorithms — duplicate, GST, price, odometer |

## Data Source

Reads from `bills` and `bill_parts` Firestore collections. Works identically in LOCAL_DEV (in-memory) and production.
