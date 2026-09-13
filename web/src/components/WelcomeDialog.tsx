import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';

const STEPS = [
  { title: 'Welcome to BillParser', description: 'Upload invoice PDFs and get structured data automatically.' },
  { title: 'Upload & Extract', description: 'Drag a PDF or click Upload. We support single and batch uploads.' },
  { title: 'Review & Approve', description: 'Review extracted data, edit if needed, and approve. Export to Excel anytime.' },
];

const STORAGE_KEY = 'hasSeenOnboarding';

export function WelcomeDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) !== 'true') setOpen(true);
  }, []);

  function finish() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) finish();
    else setOpen(next);
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.description}</DialogDescription>
        </DialogHeader>

        <div className="flex justify-center gap-2 py-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-2 w-2 rounded-full transition-colors',
                i === step ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="ghost" onClick={finish}>Skip</Button>
          <Button onClick={() => (isLast ? finish() : setStep((s) => s + 1))}>
            {isLast ? 'Get started' : 'Next'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
