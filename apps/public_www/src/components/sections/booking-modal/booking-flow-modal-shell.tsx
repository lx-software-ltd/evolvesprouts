'use client';

import type { ReactNode } from 'react';
import type { RefObject } from 'react';

import {
  OverlayDialogPanel,
  OverlayScrollableBody,
} from '@/components/shared/overlay-surface';
import {
  CloseButton,
  ModalOverlay,
} from '@/components/sections/booking-modal/shared';
import type { BookingPaymentModalContent } from '@/content';

interface BookingFlowModalShellProps {
  paymentModalContent: BookingPaymentModalContent;
  modalPanelRef: RefObject<HTMLElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  dialogTitleId: string;
  dialogDescriptionId: string;
  onClose: () => void;
  children: ReactNode;
}

export function BookingFlowModalShell({
  paymentModalContent,
  modalPanelRef,
  closeButtonRef,
  dialogTitleId,
  dialogDescriptionId,
  onClose,
  children,
}: BookingFlowModalShellProps) {
  return (
    <ModalOverlay
      onClose={onClose}
      overlayAriaLabel={paymentModalContent.closeOverlayLabel}
    >
      <OverlayDialogPanel
        panelRef={modalPanelRef}
        ariaLabelledBy={dialogTitleId}
        ariaDescribedBy={dialogDescriptionId}
        tabIndex={-1}
        className='es-booking-modal-panel overflow-visible'
      >
        <header className='flex justify-end px-4 pb-8 pt-6 sm:px-8 sm:pt-7'>
          <CloseButton
            label={paymentModalContent.closeLabel}
            onClose={onClose}
            buttonRef={closeButtonRef}
          />
        </header>
        <OverlayScrollableBody className='pb-5 sm:pb-8'>
          <div className='relative z-10 flex flex-col gap-8 pb-9 lg:flex-row lg:gap-10 lg:pb-[72px]'>
            {children}
          </div>
        </OverlayScrollableBody>
      </OverlayDialogPanel>
    </ModalOverlay>
  );
}
