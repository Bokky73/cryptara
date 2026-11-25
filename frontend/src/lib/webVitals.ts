// Lightweight Web Vitals collection using native PerformanceObserver APIs,
// avoiding a dependency on the `web-vitals` package. Covers the metrics
// budgeted in docs/performance/budgets.json: LCP, CLS, INP (with an FID
// fallback for browsers that do not yet report INP), and TTFB.

export type WebVitalName = "LCP" | "CLS" | "INP" | "FID" | "TTFB";

export type WebVitalMetric = {
  name: WebVitalName;
  value: number;
  id: string;
  navigationType?: string;
};

export type WebVitalReporter = (metric: WebVitalMetric) => void;
export type WebVitalsUnsubscribe = () => void;

function generateId() {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getNavigationType(): string | undefined {
  const [entry] = typeof performance !== "undefined" ? performance.getEntriesByType("navigation") : [];
  return (entry as PerformanceNavigationTiming | undefined)?.type;
}

function safeObserve(
  entryTypes: string[],
  callback: (entries: PerformanceObserverEntryList) => void,
  options?: PerformanceObserverInit,
): PerformanceObserver | undefined {
  if (typeof PerformanceObserver === "undefined") return undefined;

  try {
    const observer = new PerformanceObserver(callback);
    observer.observe({ type: entryTypes[0], buffered: true, ...options });
    return observer;
  } catch {
    return undefined;
  }
}

function onHidden(handler: () => void) {
  if (typeof document === "undefined" || typeof window === "undefined") return () => undefined;

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") handler();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", handler);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", handler);
  };
}

function reportTtfb(onReport: WebVitalReporter): WebVitalsUnsubscribe {
  const [entry] = typeof performance !== "undefined" ? performance.getEntriesByType("navigation") : [];
  const navigationEntry = entry as PerformanceNavigationTiming | undefined;

  if (!navigationEntry) return () => undefined;

  onReport({
    name: "TTFB",
    value: Math.max(0, navigationEntry.responseStart - navigationEntry.startTime),
    id: generateId(),
    navigationType: navigationEntry.type,
  });

  return () => undefined;
}

function reportLcp(onReport: WebVitalReporter): WebVitalsUnsubscribe {
  let latestValue = 0;
  let reported = false;

  const observer = safeObserve(["largest-contentful-paint"], (list) => {
    const entries = list.getEntries() as PerformanceEntry[];
    const last = entries[entries.length - 1];
    if (last) latestValue = last.startTime;
  });

  if (!observer) return () => undefined;

  const flush = () => {
    if (reported || latestValue <= 0) return;
    reported = true;
    observer.disconnect();
    onReport({ name: "LCP", value: latestValue, id: generateId(), navigationType: getNavigationType() });
  };

  const stopHidden = onHidden(flush);
  return () => {
    observer.disconnect();
    stopHidden();
  };
}

function reportCls(onReport: WebVitalReporter): WebVitalsUnsubscribe {
  let sessionValue = 0;
  let sessionEntries: PerformanceEntry[] = [];
  let reportedValue = 0;

  type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };

  const observer = safeObserve(["layout-shift"], (list) => {
    for (const entry of list.getEntries() as LayoutShiftEntry[]) {
      if (entry.hadRecentInput) continue;

      const firstEntry = sessionEntries[0];
      const lastEntry = sessionEntries[sessionEntries.length - 1];

      if (firstEntry && lastEntry && entry.startTime - lastEntry.startTime < 1_000 && entry.startTime - firstEntry.startTime < 5_000) {
        sessionValue += entry.value;
        sessionEntries.push(entry);
      } else {
        sessionValue = entry.value;
        sessionEntries = [entry];
      }
    }
  });

  if (!observer) return () => undefined;

  const flush = () => {
    if (sessionValue > reportedValue) {
      reportedValue = sessionValue;
      onReport({ name: "CLS", value: reportedValue, id: generateId(), navigationType: getNavigationType() });
    }
  };

  const stopHidden = onHidden(flush);
  return () => {
    observer.disconnect();
    stopHidden();
  };
}

function reportInpOrFid(onReport: WebVitalReporter): WebVitalsUnsubscribe {
  let worstInteraction = 0;
  let reported = false;

  const observer = safeObserve(
    ["event"],
    (list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.duration > worstInteraction) worstInteraction = entry.duration;
      }
    },
    { durationThreshold: 16 } as PerformanceObserverInit,
  );

  if (observer) {
    const flush = () => {
      if (reported || worstInteraction <= 0) return;
      reported = true;
      observer.disconnect();
      onReport({ name: "INP", value: worstInteraction, id: generateId(), navigationType: getNavigationType() });
    };

    const stopHidden = onHidden(flush);
    return () => {
      observer.disconnect();
      stopHidden();
    };
  }

  const fidObserver = safeObserve(["first-input"], (list) => {
    const [entry] = list.getEntries() as PerformanceEventTiming[];
    if (entry && !reported) {
      reported = true;
      fidObserver?.disconnect();
      onReport({
        name: "FID",
        value: entry.processingStart - entry.startTime,
        id: generateId(),
        navigationType: getNavigationType(),
      });
    }
  });

  return () => fidObserver?.disconnect();
}

/** Subscribes to the Web Vitals budgeted in docs/performance/budgets.json. Returns a cleanup function. */
export function observeWebVitals(onReport: WebVitalReporter): WebVitalsUnsubscribe {
  if (typeof window === "undefined") return () => undefined;

  const cleanups = [reportTtfb(onReport), reportLcp(onReport), reportCls(onReport), reportInpOrFid(onReport)];

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
