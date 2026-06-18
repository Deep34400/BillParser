import { useEffect, useRef } from 'react';
export function usePolling(tick: () => Promise<void> | void, shouldContinue: () => boolean, intervalMs = 3000) {
  const cont = useRef(shouldContinue); cont.current = shouldContinue;
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const loop = async () => { if (!active) return; await tick(); if (active && cont.current()) timer = setTimeout(loop, intervalMs); };
    loop();
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
