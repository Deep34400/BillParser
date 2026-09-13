import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';
import { TUTORIAL_SLIDES } from './tutorialSlides.js';

function TimelineMock() {
  const steps = ['Uploaded', 'Processing', 'Extracted', 'Review', 'Approved'];
  return (
    <div className="flex items-center gap-1 px-1">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-1 min-w-0">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <span className="h-4 w-4 rounded-full bg-emerald-500 text-white text-[9px] flex items-center justify-center">✓</span>
            <span className="text-[9px] text-[#67665D] truncate">{label}</span>
          </div>
          {i < steps.length - 1 && <div className="flex-1 h-px bg-emerald-400/50 mb-3" />}
        </div>
      ))}
    </div>
  );
}

function SlideMock({ kind }: { kind: string }) {
  return (
    <div className="h-full rounded-xl bg-white text-[#1B1D19] p-4 flex flex-col gap-3 shadow-inner overflow-hidden">
      {kind === 'invoices' && (
        <>
          <div className="flex gap-2">
            <div className="h-8 flex-1 rounded-md bg-[#F7F6F1]" />
            <div className="h-8 w-24 rounded-md bg-[#2E5C8A] text-white text-[11px] flex items-center justify-center font-medium">
              Upload bills
            </div>
          </div>
          <div className="space-y-2">
            {[
              ['INV-1042', 'Completed', '₹12,400'],
              ['INV-1041', 'Processing', '—'],
              ['INV-1040', 'Needs review', '₹8,210'],
            ].map(([id, status, amt]) => (
              <div key={id} className="flex items-center justify-between rounded-lg bg-[#F7F6F1] px-3 py-2 text-xs">
                <span className="font-medium">{id}</span>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px]',
                  status === 'Completed' && 'bg-emerald-100 text-emerald-800',
                  status === 'Processing' && 'bg-amber-100 text-amber-800',
                  status === 'Needs review' && 'bg-rose-100 text-rose-800',
                )}>{status}</span>
                <span className="text-[#67665D]">{amt}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {kind === 'upload' && (
        <div className="flex-1 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#2E5C8A]/40 bg-[#E8EEF4] text-sm text-[#2E5C8A] gap-2">
          <span className="text-2xl">↑</span>
          <span className="font-medium">Drop PDF or image here</span>
          <span className="text-xs text-[#67665D]">or click Browse files</span>
        </div>
      )}
      {kind === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="h-2 w-2/3 rounded-full bg-[#E4E1D3] overflow-hidden">
            <div className="h-full w-2/3 bg-[#2E5C8A] animate-pulse" />
          </div>
          <p className="text-sm text-[#67665D]">Extracting vendor, GST, and totals…</p>
        </div>
      )}
      {kind === 'detail-page' && (
        <div className="flex-1 space-y-3 text-[11px]">
          <p className="text-[#2E5C8A] font-medium">← All invoices</p>
          <TimelineMock />
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex gap-1.5 mb-1">
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">Completed</span>
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">Approved</span>
              </div>
              <p className="text-sm font-semibold">Invoice 79/BR/260027633</p>
              <p className="text-[#67665D]">MY CAR (PUNE) PVT. LTD.</p>
            </div>
            <div className="flex gap-1.5 text-[#67665D]">
              <span className="rounded border border-[#E4E1D3] px-2 py-1 bg-white">Download PDF</span>
              <span className="rounded border border-[#E4E1D3] px-2 py-1 bg-white">Edit</span>
            </div>
          </div>
        </div>
      )}
      {kind === 'detail-fields' && (
        <div className="flex-1 space-y-2 text-[11px]">
          <p className="text-[10px] uppercase tracking-wide text-[#67665D]">Invoice fields</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {[
              ['Company name', 'MY CAR (PUNE) PVT. LTD.'],
              ['GSTIN', '27AAECM2713M1ZD'],
              ['PAN', 'AAECM2713M'],
              ['Invoice date', 'Jun 22, 2026'],
              ['Vehicle reg', 'MH01FE34662'],
              ['Odometer', '48,371'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md bg-[#F7F6F1] p-2">
                <p className="text-[#67665D]">{k}</p>
                <p className="font-medium">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {kind === 'analytics' && (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {[
              ['Total spend', '₹4.2L'],
              ['Workshops', '18'],
              ['Vehicles', '64'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-[#E8EEF4] p-2">
                <p className="text-[#67665D]">{k}</p>
                <p className="text-sm font-semibold text-[#2E5C8A]">{v}</p>
              </div>
            ))}
          </div>
          <div className="flex-1 flex items-end gap-1.5 px-1 min-h-[88px]">
            {[40, 70, 55, 90, 60, 80, 48].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-[#2E5C8A]" style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="text-[10px] text-[#67665D]">Workshops · parts vs labour · monthly trend</p>
        </div>
      )}
      {kind === 'apikey' && (
        <div className="flex-1 flex flex-col gap-3 text-[11px]">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">Account · API keys</p>
            <span className="rounded-md bg-[#2E5C8A] text-white px-2.5 py-1 font-medium">Generate Key</span>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-emerald-800 font-medium mb-1">Copy this key now</p>
            <code className="block rounded bg-white px-2 py-1.5 font-mono text-[11px] text-[#1B1D19]">
              inv_8f2a9c1b0e44d7…
            </code>
            <p className="text-[#67665D] mt-2">It is shown only once. Lost it? Revoke and generate a new one.</p>
          </div>
          <p className="text-[#67665D]">
            Use the key as <code className="bg-[#F7F6F1] px-1 rounded">x-api-key</code> on invoice upload and list APIs.
          </p>
        </div>
      )}
      {kind === 'export' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="flex gap-2">
            <span className="rounded-md border border-[#E4E1D3] px-4 py-2 text-xs">CSV</span>
            <span className="rounded-md bg-[#2E5C8A] text-white px-4 py-2 text-xs">Excel</span>
          </div>
          <p className="text-xs text-[#67665D]">Help → User guide · API reference</p>
        </div>
      )}
    </div>
  );
}

export default function TutorialPage() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const slide = TUTORIAL_SLIDES[index];

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % TUTORIAL_SLIDES.length);
  }, []);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + TUTORIAL_SLIDES.length) % TUTORIAL_SLIDES.length);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(next, 5500);
    return () => window.clearInterval(id);
  }, [playing, next]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Watch how Carrum works</h1>
        <p className="text-muted-foreground mt-1">
          Upload → extract → detail page → analytics → your API key. Pause anytime.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <ol className="hidden lg:flex flex-col gap-1">
          {TUTORIAL_SLIDES.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => { setIndex(i); setPlaying(false); }}
                className={cn(
                  'w-full text-left rounded-lg px-3 py-2 text-sm transition-colors',
                  i === index
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className="font-medium">{i + 1}. {s.step}</span>
              </button>
            </li>
          ))}
        </ol>

        <div>
          <div className="rounded-2xl bg-[#1B1D19] p-3 shadow-lg">
            <div className="flex items-center gap-2 px-2 pb-2">
              <span className="h-2 w-2 rounded-full bg-red-400/80" />
              <span className="h-2 w-2 rounded-full bg-amber-400/80" />
              <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
              <span className="ml-2 text-[11px] text-white/50">Carrum · {slide.step}</span>
            </div>
            <div className="h-[340px]">
              <SlideMock kind={slide.mock} />
            </div>
          </div>

          <div className="mt-4 rounded-xl border bg-card p-4">
            <p className="text-xs font-medium text-primary">
              Step {index + 1} of {TUTORIAL_SLIDES.length}
            </p>
            <h2 className="text-lg font-semibold mt-1">{slide.title}</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{slide.narrate}</p>
          </div>

          <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((index + 1) / TUTORIAL_SLIDES.length) * 100}%` }}
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={prev} aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={next} aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" asChild>
              <Link to="/docs" className="gap-2">
                <BookOpen className="h-3.5 w-3.5" />
                User guide
              </Link>
            </Button>
          </div>

          <div className="mt-4 flex justify-center gap-1.5 lg:hidden">
            {TUTORIAL_SLIDES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setIndex(i); setPlaying(false); }}
                className={cn('h-2 rounded-full transition-all', i === index ? 'w-5 bg-primary' : 'w-2 bg-muted')}
                aria-label={`Go to ${s.title}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
