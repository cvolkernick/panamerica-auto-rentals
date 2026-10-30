"use client";

import { useRef } from "react";

type Props = {
  rentalId: string;
  vehicleName: string;
  className: string;
  label: string;
};

/**
 * Primary "Book Direct" button. Opens a modal dialog for this car.
 * NOTE: matches the live deploy; the dialog body is currently empty.
 */
export function BookDirectButton({ vehicleName, className, label }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        data-booking="direct"
        className={className}
        onClick={() => dialogRef.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={dialogRef}
        data-bd-dialog
        aria-label={`Book the ${vehicleName} direct`}
        className="fixed inset-0 z-40 m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-black sm:m-auto sm:h-[92vh] sm:w-[min(1400px,96vw)] sm:rounded-xl"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-3">
            <p className="font-heading text-sm font-bold tracking-[0.12em] uppercase">
              {vehicleName}
            </p>
            <button
              type="button"
              aria-label="Close"
              data-dialog-close
              className="flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none hover:bg-black/5"
              onClick={() => dialogRef.current?.close()}
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 sm:p-4" />
        </div>
      </dialog>
    </>
  );
}
