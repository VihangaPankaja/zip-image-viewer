import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { archivePasswordSchema } from "../../../../../shared/contracts";

export function ArchivePasswordForm({
  onSubmit,
  busy = false,
}: {
  onSubmit: (password: string) => Promise<void>;
  busy?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (busy) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || busy) return;
    const parsed = archivePasswordSchema.safeParse(input.current?.value);
    if (!parsed.success) {
      setError("Enter a single-line password of up to 1024 characters.");
      return;
    }
    if (input.current) input.current.value = "";
    setPending(true);
    setError("");
    try {
      await onSubmit(parsed.data);
    } catch {
      setError("Could not unlock this archive. Try again.");
    } finally {
      setPending(false);
      input.current?.focus();
    }
  }
  return (
    <form className="archive-password-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={id}>Archive password</label>
      <input
        ref={input}
        id={id}
        type="password"
        autoComplete="off"
        maxLength={1024}
        required
        disabled={pending || busy}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`}>Used for this attempt only. The downloaded archive is kept for retry.</p>
      {error ? (
        <p role="alert" className="download-confirm-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="primary-button" disabled={pending || busy}>
        Unlock archive
      </button>
    </form>
  );
}
