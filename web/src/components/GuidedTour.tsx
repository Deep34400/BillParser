import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  TOUR_FLOW,
  firstInvoiceIdFromDom,
  tourPathFor,
  waitForSelector,
} from '../lib/tourFlow.js';
import { ProductTour } from './ProductTour.js';

const TOUR_KEY = 'tour_completed';

const TourStartContext = createContext<(() => void) | null>(null);

export function useTourStart() {
  return useContext(TourStartContext);
}

export function useTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const invoiceId = useRef<string | null>(null);
  const busy = useRef(false);

  const waitForPath = useCallback(async (path: string) => {
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (locationRef.current === path || window.location.pathname === path) return;
      await new Promise((r) => setTimeout(r, 60));
    }
  }, []);

  const showStep = useCallback(async (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= TOUR_FLOW.length) {
      localStorage.setItem(TOUR_KEY, 'true');
      setOpen(false);
      setWaiting(false);
      busy.current = false;
      return;
    }

    busy.current = true;
    setWaiting(true);
    setOpen(true);

    const step = TOUR_FLOW[nextIndex];
    if (step.route === 'detail' && !invoiceId.current) {
      invoiceId.current = firstInvoiceIdFromDom();
    }
    if (step.route === 'detail' && !invoiceId.current) {
      await showStep(nextIndex + 1);
      return;
    }

    const path = tourPathFor(step.route, invoiceId.current);
    if (locationRef.current !== path && window.location.pathname !== path) {
      navigate(path);
      await waitForPath(path);
    }

    const el = await waitForSelector(step.target, 8000);
    if (!el) {
      await showStep(nextIndex + 1);
      return;
    }

    setIndex(nextIndex);
    setWaiting(false);
    busy.current = false;
  }, [navigate, waitForPath]);

  const startTour = useCallback(() => {
    if (busy.current) return;
    invoiceId.current = firstInvoiceIdFromDom();
    setOpen(true);
    setIndex(0);
    void (async () => {
      if (locationRef.current !== '/invoices') {
        navigate('/invoices');
        await waitForPath('/invoices');
      }
      const ready = await waitForSelector('[data-tour="upload"]', 8000);
      if (!ready) {
        setOpen(false);
        return;
      }
      invoiceId.current = firstInvoiceIdFromDom() ?? invoiceId.current;
      await showStep(0);
    })();
  }, [navigate, showStep, waitForPath]);

  const onNext = useCallback(() => {
    void showStep(index + 1);
  }, [index, showStep]);

  const onBack = useCallback(() => {
    if (index === 0) return;
    let prev = index - 1;
    if (TOUR_FLOW[prev]?.route === 'detail' && !invoiceId.current) {
      prev = Math.max(0, prev - 2);
    }
    void showStep(prev);
  }, [index, waiting, showStep]);

  const onSkip = useCallback(() => {
    localStorage.setItem(TOUR_KEY, 'true');
    setOpen(false);
    setWaiting(false);
    busy.current = false;
  }, []);

  const step = TOUR_FLOW[index] ?? TOUR_FLOW[0];

  const TourComponent = (
    <TourStartContext.Provider value={startTour}>
      {open && (
        <ProductTour
          step={step}
          stepIndex={index}
          total={TOUR_FLOW.length}
          waiting={waiting}
          onNext={onNext}
          onBack={onBack}
          onSkip={onSkip}
        />
      )}
    </TourStartContext.Provider>
  );

  return { startTour, TourComponent };
}

export function isTourCompleted(): boolean {
  return localStorage.getItem(TOUR_KEY) === 'true';
}
