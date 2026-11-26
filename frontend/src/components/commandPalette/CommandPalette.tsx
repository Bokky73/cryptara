"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { usePaletteController } from "@/lib/commandPalette/controller";
import { resultAnnouncement } from "@/lib/commandPalette/groups";
import type { Command, PaletteScope, SessionAsset } from "@/lib/commandPalette/schema";
import { SearchInput } from "./SearchInput";
import { ResultList } from "./ResultList";
import { ShortcutHelp } from "./ShortcutHelp";
export function CommandPalette({ open, scope, assets, close, navigate }: { open: boolean; scope: PaletteScope | null; assets: readonly SessionAsset[]; close: () => void; navigate: (href: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = usePaletteController(scope, assets);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  useEffect(() => { dialog.current?.querySelector(`#command-result-${controller.selected}`)?.scrollIntoView?.({ block: "nearest", behavior: "instant" }); }, [controller.selected]);
  function choose(command: Command) { close(); navigate(controller.activate(command)); }
  function keydown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); const length = controller.results.length;
      if (length) controller.setSelected((controller.selected + (event.key === "ArrowDown" ? 1 : length - 1)) % length);
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && controller.results[controller.selected]) {
      event.preventDefault(); choose(controller.results[controller.selected]);
    }
    if (event.key === "Tab") {
      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || !focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.current?.contains(active))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.current?.contains(active))) {
        event.preventDefault(); first.focus();
      }
    }
  }
  return <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby="command-title" aria-describedby="command-help" onKeyDown={keydown}
    onCancel={event => { event.preventDefault(); close(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 text-[var(--color-fg)] shadow-xl backdrop:bg-black/70 motion-reduce:scroll-auto">
    <h2 id="command-title" className="mb-4 text-xl font-semibold">Quick navigation</h2>
    <SearchInput value={controller.query} onChange={controller.setQuery} scanLabel={controller.scanTarget?.kind} activeId={controller.results.length ? `command-result-${controller.selected}` : undefined} />
    <ResultList results={controller.results} selected={controller.selected} choose={choose} select={controller.setSelected} />
    {!controller.results.length && <p className="my-4">No matching pages, insights or session assets.</p>}
    {!assets.length && <p className="text-sm">No session assets supplied. Page navigation is available.</p>}
    <LiveRegion message={resultAnnouncement(controller.results)} /><ShortcutHelp />
    <button type="button" onClick={close} className="mt-4 min-h-[44px] min-w-[44px] rounded-lg border px-4 py-2 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">Close search</button>
  </dialog>;
}
