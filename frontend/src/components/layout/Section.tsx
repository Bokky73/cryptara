import type { ReactNode } from "react";

/**
 * A titled block within a page (issue #148).
 *
 * `min-w-0` is the important part: a grid or flex child defaults to
 * `min-width: auto`, which refuses to shrink below its content. That single
 * default is what pushes a wide table past the viewport and makes the page
 * scroll horizontally, so every section opts out of it.
 */
export function Section({
  children,
  title,
  description,
  actions,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 rounded-[var(--radius-lg,8px)] border border-[var(--color-border)] bg-[var(--color-glass-bg)] p-4 sm:p-5 ${className}`}
    >
      {title ? (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-muted)]">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default Section;
