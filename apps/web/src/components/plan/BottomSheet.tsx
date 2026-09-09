"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A bottom sheet, portalled to the phone-frame screen (`#phone-screen`) so it anchors to
 * the visible viewport rather than the scrolled screen body — a `position: fixed` child of
 * the animated `.screen-wrapper` is contained by it, which put the sheet off-screen when
 * the list under it was scrolled. Falls back to `document.body` (real mobile client, no
 * phone frame).
 */
export function BottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById("phone-screen") ?? document.body);
  }, []);
  if (!target) return null;

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal aria-label={label}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    target,
  );
}
