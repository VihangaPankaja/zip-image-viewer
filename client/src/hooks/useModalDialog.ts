import { useEffect, useRef } from "react";

export function useModalDialog(open = true) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
    }
    const opener = openerRef.current;
    return () => {
      requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        const activeElement = document.activeElement;
        if (
          activeElement &&
          activeElement !== document.body &&
          activeElement.isConnected &&
          !dialog?.contains(activeElement)
        ) {
          return;
        }
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        else document.getElementById("downloads-title")?.focus();
      });
    };
  }, [open]);
  return dialogRef;
}
