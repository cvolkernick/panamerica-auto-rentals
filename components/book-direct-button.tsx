"use client";

import { useEffect, useRef, useState } from "react";

import { WHEELBASE_DEALER_ID, wheelbaseBookingUrl } from "@/data/fleet";

const WIDGET_SRC =
  "https://d2toxav8qvoos4.cloudfront.net/latest/wheelbase-widget.js";

const EMBED_TIMEOUT_MS = 10000;

/**
 * Inject the Wheelbase loader once per page, on first Book Direct click.
 * Resolves true once <listing-details> is defined, false on error or timeout.
 */
function loadWheelbaseWidget(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!document.querySelector(`script[src="${WIDGET_SRC}"]`)) {
    const script = document.createElement("script");
    script.type = "module";
    script.src = WIDGET_SRC;
    document.head.appendChild(script);
  }
  return Promise.race([
    customElements.whenDefined("listing-details").then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), EMBED_TIMEOUT_MS)),
  ]);
}

type Props = {
  rentalId: string;
  vehicleName: string;
  className: string;
  label: string;
};

/**
 * Primary "Book Direct" button. Opens a dialog that renders Wheelbase's
 * <listing-details> for this car. The element is only rendered after a click.
 *
 * The dialog is opened with show() (not showModal()) and layered with z-40 plus
 * a z-39 backdrop. A top-layer modal would sit above Wheelbase's own popovers
 * (date pickers etc., z-50+) and make them unclickable. Because it is non-modal
 * we handle Escape and the backdrop click ourselves, and lock scrolling on
 * <html> (Wheelbase resets <body> overflow).
 */
export function BookDirectButton({ rentalId, vehicleName, className, label }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [embedFailed, setEmbedFailed] = useState(false);
  const bookingUrl = wheelbaseBookingUrl(rentalId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      document.documentElement.style.removeProperty("overflow");
      setIsOpen(false);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) dialogRef.current?.close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const open = () => {
    loadWheelbaseWidget().then((ok) => setEmbedFailed(!ok));
    setOpened(true);
    setIsOpen(true);
    document.documentElement.style.overflow = "hidden";
    dialogRef.current?.show();
  };
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        data-booking="direct"
        className={className}
      >
        {label}
      </button>
      {isOpen && (
        <div
          aria-hidden
          data-dialog-backdrop
          onClick={close}
          className="fixed inset-0 z-[39] bg-black/70"
        />
      )}
      <dialog
        ref={dialogRef}
        data-bd-dialog
        aria-label={`Book the ${vehicleName} direct`}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="fixed inset-0 z-40 m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-black sm:m-auto sm:h-[92vh] sm:w-[min(1400px,96vw)] sm:rounded-xl"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-3">
            <p className="font-heading text-sm font-bold tracking-[0.12em] uppercase">
              {vehicleName}
            </p>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              data-dialog-close
              className="flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none hover:bg-black/5"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 sm:p-4">
            {opened && !embedFailed && (
              <listing-details
                dealer-id={WHEELBASE_DEALER_ID}
                rental-id={rentalId}
              ></listing-details>
            )}
            {opened && embedFailed && (
              <p data-bd-fallback className="p-6 text-center text-black/70">
                The booking calendar didn&apos;t load here.
              </p>
            )}
            <p className="py-4 text-center text-sm">
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-bd-open-booking
                className="font-heading tracking-[0.12em] text-red uppercase underline"
              >
                Open booking
              </a>
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
