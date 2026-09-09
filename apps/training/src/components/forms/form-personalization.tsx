'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { FormWizard } from '@/components/forms/form-wizard';
import type { FormContent, FormsCommonContent } from '@/content/form-types';
import { applyFormContactPlaceholders } from '@/lib/apply-form-contact-placeholders';
import { FORM_CONTACT_PLACEHOLDER_FALLBACKS } from '@/lib/contact-placeholders';
import { fetchFormContactContext } from '@/lib/forms-api';

const CONTACT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FormPersonalizationProps {
  form: FormContent;
  common: FormsCommonContent;
}

export function FormPersonalization({ form, common }: FormPersonalizationProps) {
  const searchParams = useSearchParams();
  const rawContactId = searchParams.get('contact')?.trim() ?? '';
  const contactId =
    form.requiresContact === true && CONTACT_ID_PATTERN.test(rawContactId)
      ? rawContactId.toLowerCase()
      : '';
  const [fetched, setFetched] = useState<{
    contactId: string;
    placeholders: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!contactId) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await fetchFormContactContext(form.slug, contactId, controller.signal);
        if (!controller.signal.aborted) {
          setFetched({
            contactId,
            placeholders: payload.placeholders,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setFetched({
            contactId,
            placeholders: FORM_CONTACT_PLACEHOLDER_FALLBACKS,
          });
        }
      }
    })();
    return () => controller.abort();
  }, [contactId, form.slug]);

  const placeholders = useMemo(() => {
    if (!contactId) {
      return FORM_CONTACT_PLACEHOLDER_FALLBACKS;
    }
    if (fetched?.contactId === contactId) {
      return {
        ...FORM_CONTACT_PLACEHOLDER_FALLBACKS,
        ...fetched.placeholders,
      };
    }
    return FORM_CONTACT_PLACEHOLDER_FALLBACKS;
  }, [contactId, fetched]);

  const personalizedForm = useMemo(
    () => applyFormContactPlaceholders(form, placeholders),
    [form, placeholders],
  );

  return (
    <>
      <h1 className='es-type-title mx-auto mb-8 w-full max-w-xl text-center text-2xl'>
        {personalizedForm.title}
      </h1>
      <FormWizard form={personalizedForm} common={common} contactId={contactId || null} />
    </>
  );
}
