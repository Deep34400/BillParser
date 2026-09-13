import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.js';
import { Skeleton } from '@/components/ui/skeleton.js';

interface Endpoint {
  method: string;
  path: string;
  auth: string;
  description: string;
  params?: Record<string, string>;
  request?: string;
  response?: string;
  errors?: Array<{ status: number; message: string }>;
}

interface DocsData {
  version: string;
  baseUrl: string;
  authentication: { jwt: string; apiKey: string };
  errorShape?: string;
  endpoints: Endpoint[];
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  POST: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  PATCH: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function CodeBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{text}</pre>
    </div>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
      >
        <Badge className={`${METHOD_COLOR[ep.method] ?? ''} font-mono text-xs shrink-0 w-16 justify-center`}>
          {ep.method}
        </Badge>
        <div className="flex-1 min-w-0">
          <code className="text-sm font-medium">{ep.path}</code>
          <p className="text-xs text-muted-foreground mt-0.5">{ep.description}</p>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">{ep.auth}</Badge>
      </button>
      {open && (
        <div className="border-t px-3 py-3 space-y-3">
          {ep.params && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(ep.params).map(([k, v]) => (
                <span key={k} className="text-[11px] bg-muted px-1.5 py-0.5 rounded">
                  {k}: <span className="text-muted-foreground">{v}</span>
                </span>
              ))}
            </div>
          )}
          {ep.request && <CodeBlock label="Request" text={ep.request} />}
          {ep.response && <CodeBlock label="Response" text={ep.response} />}
          {ep.errors && ep.errors.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Errors</p>
              <ul className="space-y-1">
                {ep.errors.map((err) => (
                  <li key={`${err.status}-${err.message}`} className="text-xs">
                    <span className="font-mono text-destructive">{err.status}</span>
                    {' — '}
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const { data, isLoading } = useQuery<DocsData>({
    queryKey: ['api-docs', 'invoices'],
    queryFn: async () => {
      const res = await fetch('/api/docs');
      const json = await res.json();
      return json.data;
    },
    staleTime: Infinity,
  });

  if (isLoading || !data) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Invoice API</h1>
        <p className="text-muted-foreground mt-1">
          Upload, extract, list, update, approve. Click a row for request, response, and errors.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Auth</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>JWT:</strong> {data.authentication.jwt}</p>
          <p><strong>API key:</strong> {data.authentication.apiKey}</p>
        </CardContent>
      </Card>

      {data.errorShape && (
        <Card>
          <CardHeader><CardTitle className="text-base">Error shape</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto">{data.errorShape}</pre>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {data.endpoints.map((ep) => (
          <EndpointCard key={`${ep.method}-${ep.path}`} ep={ep} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        How to use the product UI: <Link to="/docs" className="underline">user guide</Link>
      </p>
    </div>
  );
}
