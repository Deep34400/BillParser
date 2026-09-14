import { Link } from 'react-router-dom';
import { FileText, Search, CheckCircle2, BarChart3, Download, MessageSquare, KeyRound, Settings, Columns2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Button } from '@/components/ui/button.js';

const SECTIONS = [
  {
    icon: FileText,
    title: 'Upload invoices',
    body: 'On Invoices, click Upload. Drop many PDFs or images, one zip of invoices, or paste http / signed S3 URLs. Optional batch name groups them. Each file still runs OCR on its own. Use the batch dropdown and Retry failed when a file errors.',
  },
  {
    icon: Columns2,
    title: 'Compare two invoices',
    body: 'Open Compare, or tick exactly two rows on Invoices and click Compare 2. You can also paste two JSON extracts or upload two PDFs (OCR runs first). Totals are compared with rules. Gemini (or the Compare model in Settings) only pairs leftover names like brake pad vs pads, then writes a short note. Check the mismatch list — AI cannot change money.',
  },
  {
    icon: Search,
    title: 'Find and filter',
    body: 'Search by invoice number, vendor, or vehicle. Use the status pills for Processing, Completed, and Needs Review. Amount and date filters run on the server so large lists stay fast.',
  },
  {
    icon: CheckCircle2,
    title: 'Review and approve',
    body: 'Open an invoice to check vendor, GSTIN, line items, and totals. Edit a field if OCR missed it, then submit for approval. Admins can approve or reject from the same screen.',
  },
  {
    icon: MessageSquare,
    title: 'Leave comments',
    body: 'The comments panel on the invoice is for notes between you and an admin — missing GST, a wrong total, or why something was rejected.',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    body: 'Analytics shows spend, invoice volume, and status. Workshops and Vehicles have charts for top spend and parts vs labour. Monthly view combines spend bars with invoice counts.',
  },
  {
    icon: Download,
    title: 'Export',
    body: 'From the invoice list, export the current filters as CSV or Excel (.xlsx). Item-level export is next to those buttons.',
  },
  {
    icon: KeyRound,
    title: 'Account and API keys',
    body: 'Account is for your profile, webhooks, and API keys. Use a key with x-api-key when calling the API from another system.',
  },
  {
    icon: Settings,
    title: 'Settings (admin)',
    body: 'Admins set the OCR pipeline, the Compare model (Gemini by default), fallback models, provider credentials, and cost rates. Regular users do not see this page.',
  },
];

export default function UserGuidePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User guide</h1>
        <p className="text-muted-foreground mt-1">
          How to use Carrum — upload invoices, review OCR, approve, and export.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/tutorial">Watch tutorial</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/api-docs">API reference</Link>
          </Button>
        </div>
      </div>

      {SECTIONS.map(({ icon: Icon, title, body }) => (
        <Card key={title}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-primary" />
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
