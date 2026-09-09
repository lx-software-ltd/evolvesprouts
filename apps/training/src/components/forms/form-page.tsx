import { FormPersonalization } from '@/components/forms/form-personalization';
import type { FormContent, FormsCommonContent } from '@/content/form-types';
import { SITE_COMMON } from '@/content/site-types';
import { getPublicWwwHomeUrl } from '@/lib/public-www-url';

export interface FormPageProps {
  form: FormContent;
  common: FormsCommonContent;
}

export function FormPage({ form, common }: FormPageProps) {
  const publicWwwHomeUrl = getPublicWwwHomeUrl();

  const logo = (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG from /public/images
    <img
      src='/images/evolvesprouts-logo.svg'
      alt={SITE_COMMON.a11y.logoLabel}
      className='mx-auto h-28 w-auto'
    />
  );

  return (
    <main className='flex min-h-screen flex-col px-6 py-10'>
      <header className='mx-auto mb-4 w-full max-w-xl text-center'>
        <div className='mb-4'>
          {publicWwwHomeUrl ? (
            <a
              href={publicWwwHomeUrl}
              className='inline-block rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900'
              aria-label={SITE_COMMON.a11y.websiteLinkLabel}
            >
              {logo}
            </a>
          ) : (
            logo
          )}
        </div>
      </header>
      <FormPersonalization form={form} common={common} />
    </main>
  );
}
