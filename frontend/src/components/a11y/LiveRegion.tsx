import { VisuallyHidden } from "@/components/a11y/VisuallyHidden";

type LiveRegionProps = {
  message: string | null | undefined;
  /**
   * "polite" (default) waits for the screen reader to finish its current
   * announcement; "assertive" interrupts immediately and should be reserved
   * for errors that block the user's task.
   */
  politeness?: "polite" | "assertive";
  /** Render the message visibly (e.g. inline status text) instead of screen-reader-only. */
  visible?: boolean;
  className?: string;
  /** Optional id, e.g. to reference this region from an input's aria-describedby. */
  id?: string;
};

/**
 * A single shared aria-live region. Keep it mounted at all times (even when
 * `message` is empty) so assistive technology has already registered the
 * region before the first status update is announced.
 */
export function LiveRegion({ message, politeness = "polite", visible = false, className, id }: LiveRegionProps) {
  const content = message ?? "";

  if (visible) {
    return (
      <div id={id} role={politeness === "assertive" ? "alert" : "status"} aria-live={politeness} aria-atomic="true" className={className}>
        {content}
      </div>
    );
  }

  return (
    <VisuallyHidden as="div" className={className}>
      <div id={id} role={politeness === "assertive" ? "alert" : "status"} aria-live={politeness} aria-atomic="true">
        {content}
      </div>
    </VisuallyHidden>
  );
}

/**
 * Announce a scan milestone ("Analysis started", "Risk report ready: ...").
 * Thin wrapper so async flows share consistent wording and politeness.
 */
export function ScanAnnouncement({ message, visible = false, className, id }: Omit<LiveRegionProps, "politeness">) {
  return <LiveRegion message={message} politeness="polite" visible={visible} className={className} id={id} />;
}

/**
 * Announce a clipboard copy confirmation ("Copied to clipboard").
 */
export function CopyAnnouncement({ message, visible = false, className, id }: Omit<LiveRegionProps, "politeness">) {
  return <LiveRegion message={message} politeness="polite" visible={visible} className={className} id={id} />;
}

/**
 * Announce a watchlist or rule mutation ("Added to watchlist", "Rule saved").
 */
export function MutationAnnouncement({ message, visible = false, className, id }: Omit<LiveRegionProps, "politeness">) {
  return <LiveRegion message={message} politeness="polite" visible={visible} className={className} id={id} />;
}
