import type { Invoice } from '../../types/index.js';
import { dateFmt } from '../../lib/format.js';
import { resolveInvoiceData } from './invoiceData.js';

interface Field {
  label: string;
  value: string;
}

function field(label: string, value: string | number | null | undefined): Field {
  return { label, value: value != null && value !== '' ? String(value) : '—' };
}

export function InvoiceFieldGrid({ inv }: { inv: Invoice }) {
  const data = resolveInvoiceData(inv);
  const vehicle = data?.vehicle_details;

  const fields: Field[] = [
    field('Company name', data?.company_name ?? inv.vendorName),
    field('GSTIN', data?.gstin ?? inv.gstin ?? inv.vendorTaxId),
    field('PAN', data?.pan ?? inv.pan),
    field('Invoice date', inv.invoiceDate ? dateFmt(inv.invoiceDate) : data?.invoice_date ?? '—'),
    field('Vehicle reg', vehicle?.registration_number ?? inv.registrationNumber),
    field('Chassis', vehicle?.chassis_number),
    field('Odometer', vehicle?.mileage_odometer_reading),
  ];

  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Invoice fields
      </div>
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
        {fields.map(({ label, value }) => (
          <div key={label} className="bg-card px-4 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className="text-sm font-medium text-foreground">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
