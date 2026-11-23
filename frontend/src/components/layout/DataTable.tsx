import React, { useCallback, useRef, useState } from 'react';
import { LiveRegion } from '../a11y/LiveRegion';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Render the cell content. */
  render?: (row: T, index: number) => React.ReactNode;
  /** Accessor used for the mobile card label/value when render is not provided. */
  accessor?: (row: T) => React.ReactNode;
  /** Numeric columns get tabular-nums + right alignment. */
  numeric?: boolean;
  /** Truncate long values (addresses, hashes) in the middle with a tooltip + copy. */
  truncate?: boolean;
  /** Hide this column in the mobile card stack. */
  hideOnMobile?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Accessible label for the table. */
  ariaLabel?: string;
  /** Force a layout mode; defaults to responsive (cards < 640px). */
  mode?: 'responsive' | 'table';
  emptyMessage?: React.ReactNode;
  onRowClick?: (row: T, index: number) => void;
}

const MOBILE_BREAKPOINT = 640;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

/** Middle-truncate a string: 0x1234...abcd */
export function middleTruncate(value: string, head = 6, tail = 4): string {
  if (!value || value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function TruncatedValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [value]);

  return (
    <span className="inline-flex items-center gap-1">
      <span title={value} aria-label={value} className="font-mono">
        {middleTruncate(value)}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${value}`}
        className="rounded px-1 text-xs text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {copied ? '\u2713' : '\u2398'}
      </button>
      <LiveRegion message={copied ? 'Address copied' : ''} />
    </span>
  );
}

function renderCell<T>(col: DataTableColumn<T>, row: T, index: number): React.ReactNode {
  const raw = col.render ? col.render(row, index) : col.accessor ? col.accessor(row) : null;
  if (col.truncate && typeof raw === 'string') {
    return <TruncatedValue value={raw} />;
  }
  return raw;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  ariaLabel,
  mode = 'responsive',
  emptyMessage = 'No data',
  onRowClick,
}: DataTableProps<T>) {
  const isMobile = useIsMobile();
  const stacked = mode === 'responsive' && isMobile;

  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-500">{emptyMessage}</div>;
  }

  if (stacked) {
    return (
      <ul className="flex flex-col gap-3" aria-label={ariaLabel}>
        {rows.map((row, index) => (
          <li
            key={rowKey(row, index)}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
          >
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((col) => (
                  <React.Fragment key={col.key}>
                    <dt className="text-slate-500">{col.header}</dt>
                    <dd
                      className={[
                        'text-right',
                        col.numeric ? 'tabular-nums' : '',
                        col.className ?? '',
                      ].join(' ')}
                    >
                      {renderCell(col, row, index)}
                    </dd>
                  </React.Fragment>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="relative w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label={ariaLabel}>
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={[
                  'whitespace-nowrap px-3 py-2 font-medium',
                  col.numeric ? 'text-right tabular-nums' : '',
                  col.className ?? '',
                ].join(' ')}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className="border-b border-slate-100 last:border-0"
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[
                    'px-3 py-2',
                    col.numeric ? 'text-right tabular-nums' : '',
                    col.className ?? '',
                  ].join(' ')}
                >
                  {renderCell(col, row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
