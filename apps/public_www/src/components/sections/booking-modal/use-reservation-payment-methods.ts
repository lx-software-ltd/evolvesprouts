import { useEffect, useMemo, useRef, useState } from 'react';

import {
  PAYMENT_METHOD_BANK_TRANSFER,
  PAYMENT_METHOD_FPS,
  PAYMENT_METHOD_STRIPE,
  type PaymentMethodFlags,
  type PaymentMethodOption,
} from '@/components/sections/booking-modal/reservation-form-types';
import {
  resolvePublicBookingPaymentOptionFlags,
  type PublicBookingPaymentOptionFlags,
} from '@/lib/booking-payment-options';

export function resolvePaymentMethodFlags(
  flags: PublicBookingPaymentOptionFlags,
): PaymentMethodFlags {
  let fpsQr = flags.fpsQrEnabled;
  let bankTransfer = flags.bankTransferEnabled;
  let stripeCards = flags.stripeCardsEnabled;
  if (!fpsQr && !bankTransfer && !stripeCards) {
    fpsQr = true;
    bankTransfer = true;
    stripeCards = true;
  }
  return { fpsQr, bankTransfer, stripeCards };
}

export function getDefaultPaymentMethod(flags: PaymentMethodFlags): PaymentMethodOption {
  if (flags.fpsQr) {
    return PAYMENT_METHOD_FPS;
  }
  if (flags.bankTransfer) {
    return PAYMENT_METHOD_BANK_TRANSFER;
  }
  return PAYMENT_METHOD_STRIPE;
}

export function isPaymentMethodAllowed(
  method: PaymentMethodOption,
  flags: PaymentMethodFlags,
): boolean {
  if (method === PAYMENT_METHOD_FPS) {
    return flags.fpsQr;
  }
  if (method === PAYMENT_METHOD_BANK_TRANSFER) {
    return flags.bankTransfer;
  }
  return flags.stripeCards;
}

interface UseReservationPaymentMethodsOptions {
  isFreeReservation: boolean;
}

export function useReservationPaymentMethods({
  isFreeReservation,
}: UseReservationPaymentMethodsOptions) {
  const paymentMethodFlags = useMemo(() => {
    return resolvePaymentMethodFlags(resolvePublicBookingPaymentOptionFlags());
  }, []);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodOption>(
    () => {
      return getDefaultPaymentMethod(
        resolvePaymentMethodFlags(resolvePublicBookingPaymentOptionFlags()),
      );
    },
  );
  const showPaymentMethodPickers =
    (paymentMethodFlags.fpsQr ? 1 : 0) +
      (paymentMethodFlags.bankTransfer ? 1 : 0) +
      (paymentMethodFlags.stripeCards ? 1 : 0) >
    1;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep selected method valid when flags change
    setSelectedPaymentMethod((current) => {
      if (isPaymentMethodAllowed(current, paymentMethodFlags)) {
        return current;
      }
      return getDefaultPaymentMethod(paymentMethodFlags);
    });
  }, [paymentMethodFlags]);

  const prevIsFreeReservationRef = useRef(isFreeReservation);
  useEffect(() => {
    if (prevIsFreeReservationRef.current && !isFreeReservation) {
      setSelectedPaymentMethod(getDefaultPaymentMethod(paymentMethodFlags));
    }
    prevIsFreeReservationRef.current = isFreeReservation;
  }, [isFreeReservation, paymentMethodFlags]);

  return {
    paymentMethodFlags,
    selectedPaymentMethod,
    setSelectedPaymentMethod,
    showPaymentMethodPickers,
  };
}
