import type { ReactNode } from "react";

/**
 * The page container (issue #148).
 *
 * Composes inside `<main>`, which already owns the max width and the gutter —
 * adding them again here would double the padding on every migrated route.
 *
 * What this contributes is `min-w-0` and `overflow-x-clip`: a grid or flex
 * child defaults to `min-width: auto` and refuses to shrink below its content,
 * which is what pushes a wide table past the viewport. Clipping here guarantees
 * that a single wide child can never make the page body scroll sideways; wide
 * content scrolls inside its own container instead.
 */
export function Page({
  children,
  title,
  description,
  actions,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="w-full min-w-0 overflow-x-clip">
      {title ? (
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--color-fg)] sm:text-2xl">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-fg-muted)]">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

export default Page;
