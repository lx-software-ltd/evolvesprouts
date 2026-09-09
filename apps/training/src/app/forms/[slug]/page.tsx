import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { FormPage } from '@/components/forms/form-page';
import {
  FORMS_COMMON,
  getAllFormSlugs,
  getFormContent,
  isValidFormSlug,
} from '@/lib/forms';

interface FormRouteProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllFormSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: FormRouteProps): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidFormSlug(slug)) {
    return {};
  }
  const form = getFormContent(slug);
  if (!form) {
    return {};
  }
  return {
    title: form.title,
    robots: {
      index: false,
      follow: false,
      noarchive: true,
    },
  };
}

export default async function FormRoutePage({ params }: FormRouteProps) {
  const { slug } = await params;
  if (!isValidFormSlug(slug)) {
    notFound();
  }
  const form = getFormContent(slug);
  if (!form || form.slug !== slug) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <FormPage form={form} common={FORMS_COMMON} />
    </Suspense>
  );
}
