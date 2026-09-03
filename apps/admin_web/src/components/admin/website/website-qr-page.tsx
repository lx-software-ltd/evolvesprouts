'use client';

import { useEffect, useMemo, useState } from 'react';

import { PublicSiteQrExportPanel } from '@/components/admin/public-site-qr-export-panel';
import { AdminEditorPanel } from '@/components/ui/admin-editor-panel';
import { AdminField, AdminFieldGrid } from '@/components/ui/admin-field-grid';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { trackAdminAnalyticsEvent } from '@/lib/admin-analytics';
import { getPublicSiteBaseUrl, getTrainingSiteBaseUrl } from '@/lib/config';
import { PUBLIC_SITE_PAGE_PRESETS } from '@/lib/public-site-page-presets';
import {
  buildLocalizedPublicPageUrl,
  buildSitePageUrl,
  normalizePublicSitePathInput,
  normalizePublicSiteSrcValue,
  sanitizePublicSiteSrcQueryInput,
} from '@/lib/public-site-page-urls';
import { QR_SITE_TARGET_OPTIONS, type QrSiteTarget } from '@/lib/qr-site-target';
import {
  MY_BEST_AUNTIE_REFERRAL_LOCALES,
  REFERRAL_LOCALE_DISPLAY_LABELS,
  type MyBestAuntieReferralLocale,
} from '@/lib/referral-links';
import { TRAINING_SITE_PAGE_PRESETS } from '@/lib/training-site-page-presets';

const CUSTOM_PRESET_VALUE = '__custom__';

function pathToDownloadBase(path: string): string {
  if (path === '/') {
    return 'home';
  }
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  return trimmed.replace(/\//g, '-') || 'page';
}

function presetsForSite(site: QrSiteTarget) {
  return site === 'training' ? TRAINING_SITE_PAGE_PRESETS : PUBLIC_SITE_PAGE_PRESETS;
}

function defaultPresetForSite(site: QrSiteTarget): string {
  return presetsForSite(site)[0]?.pathInput ?? '/';
}

export function WebsiteQrPage() {
  const publicSiteBaseUrl = useMemo(() => getPublicSiteBaseUrl(), []);
  const trainingSiteBaseUrl = useMemo(() => getTrainingSiteBaseUrl(), []);
  const [siteTarget, setSiteTarget] = useState<QrSiteTarget>('public_www');
  const [locale, setLocale] = useState<MyBestAuntieReferralLocale>('en');
  const [presetValue, setPresetValue] = useState<string>(
    PUBLIC_SITE_PAGE_PRESETS[0]?.pathInput ?? '/',
  );
  const [customPathInput, setCustomPathInput] = useState('');
  const [appendSrcQuery, setAppendSrcQuery] = useState(false);
  const [srcQueryValue, setSrcQueryValue] = useState('');
  const isCustom = presetValue === CUSTOM_PRESET_VALUE;
  const isTrainingSite = siteTarget === 'training';
  const baseUrl = isTrainingSite ? trainingSiteBaseUrl : publicSiteBaseUrl;
  const pagePresets = presetsForSite(siteTarget);

  const normalizedSrcForQuery = useMemo(
    () => (appendSrcQuery ? normalizePublicSiteSrcValue(srcQueryValue) : ''),
    [appendSrcQuery, srcQueryValue],
  );

  const normalizedPathResult = useMemo(() => {
    if (isCustom && !customPathInput.trim()) {
      return { path: '', error: 'Enter a path, or choose a preset above.' };
    }
    const raw = isCustom ? customPathInput : presetValue;
    return normalizePublicSitePathInput(raw);
  }, [customPathInput, isCustom, presetValue]);

  const builtUrl = useMemo(() => {
    if (!baseUrl || normalizedPathResult.error || !normalizedPathResult.path) {
      return '';
    }
    if (isTrainingSite) {
      return buildSitePageUrl({
        baseUrl,
        path: normalizedPathResult.path,
      });
    }
    return buildLocalizedPublicPageUrl({
      baseUrl,
      locale,
      path: normalizedPathResult.path,
    });
  }, [baseUrl, isTrainingSite, locale, normalizedPathResult.error, normalizedPathResult.path]);

  const builtUrlForQr = useMemo(() => {
    if (!builtUrl) {
      return '';
    }
    if (!appendSrcQuery) {
      return builtUrl;
    }
    if (!normalizedSrcForQuery) {
      return builtUrl;
    }
    try {
      const url = new URL(builtUrl);
      url.searchParams.set('src', normalizedSrcForQuery);
      return url.toString();
    } catch {
      return builtUrl;
    }
  }, [appendSrcQuery, builtUrl, normalizedSrcForQuery]);

  const pathForAnalytics = normalizedPathResult.path || '';

  useEffect(() => {
    if (!builtUrlForQr) {
      return;
    }
    trackAdminAnalyticsEvent('admin_public_page_qr_opened', {
      public_site_path: pathForAnalytics,
      locale: isTrainingSite ? 'none' : locale,
      qr_site_target: siteTarget,
    });
  }, [builtUrlForQr, isTrainingSite, locale, pathForAnalytics, siteTarget]);

  const configError = !baseUrl.trim()
    ? isTrainingSite
      ? 'Set NEXT_PUBLIC_TRAINING_SITE_BASE_URL to generate training site links.'
      : 'Set NEXT_PUBLIC_PUBLIC_SITE_BASE_URL to generate public page links.'
    : '';

  const pathError = normalizedPathResult.error;

  const downloadLocaleSuffix = isTrainingSite ? 'training' : locale;
  const downloadBase = `${normalizedSrcForQuery ? `${normalizedSrcForQuery}-` : ''}page-${pathToDownloadBase(normalizedPathResult.path || '/')}-${downloadLocaleSuffix}`;

  const optionsDisabled = Boolean(configError) || Boolean(pathError) || !builtUrl;

  return (
    <Card aria-label='Website QR codes'>
      <AdminEditorPanel>
        <AdminFieldGrid columns={4}>
          <AdminField label='Site' htmlFor='website-qr-site-target'>
            <Select
              id='website-qr-site-target'
              value={siteTarget}
              onChange={(event) => {
                const nextSite = event.target.value as QrSiteTarget;
                setSiteTarget(nextSite);
                setPresetValue(defaultPresetForSite(nextSite));
                setCustomPathInput('');
              }}
            >
              {QR_SITE_TARGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </AdminField>
          <AdminField
            label='Page'
            htmlFor='website-qr-preset-page'
            hint={
              isTrainingSite
                ? 'Training URLs use paths only (no locale).'
                : 'Public URLs include a locale prefix and trailing slash.'
            }
          >
            <Select
              id='website-qr-preset-page'
              value={isCustom ? CUSTOM_PRESET_VALUE : presetValue}
              onChange={(event) => {
                const next = event.target.value;
                setPresetValue(next);
              }}
              disabled={Boolean(configError)}
            >
              {pagePresets.map((preset) => (
                <option key={preset.pathInput} value={preset.pathInput}>
                  {preset.label}
                </option>
              ))}
              <option value={CUSTOM_PRESET_VALUE}>Custom path…</option>
            </Select>
          </AdminField>
          {!isTrainingSite ? (
            <AdminField label='Locale' htmlFor='website-qr-locale'>
              <Select
                id='website-qr-locale'
                value={locale}
                onChange={(event) => setLocale(event.target.value as MyBestAuntieReferralLocale)}
                disabled={Boolean(configError)}
              >
                {MY_BEST_AUNTIE_REFERRAL_LOCALES.map((entry) => (
                  <option key={entry} value={entry}>
                    {REFERRAL_LOCALE_DISPLAY_LABELS[entry]}
                  </option>
                ))}
              </Select>
            </AdminField>
          ) : null}
          {isCustom ? (
            <AdminField
              label='Custom path'
              htmlFor='website-qr-custom-path'
              span={isTrainingSite ? 2 : 1}
              error={pathError || undefined}
              errorId='website-qr-custom-path-error'
              hint={
                isTrainingSite
                  ? 'Site path only (letters, numbers, hyphens per segment). Omit the domain; the training site origin is added automatically.'
                  : 'Site path only (letters, numbers, hyphens per segment). Omit the locale; it is added automatically for the public website.'
              }
            >
              <Input
                id='website-qr-custom-path'
                value={customPathInput}
                onChange={(event) => setCustomPathInput(event.target.value)}
                placeholder={
                  isTrainingSite
                    ? 'e.g. /polls/workshop-food-jun-26'
                    : 'e.g. /about-us or /easter-2026-montessori-play-coaching-workshop'
                }
                disabled={Boolean(configError)}
                autoComplete='off'
                aria-invalid={pathError ? true : undefined}
                aria-describedby={pathError ? 'website-qr-custom-path-error' : undefined}
              />
            </AdminField>
          ) : null}
        </AdminFieldGrid>
        {!isCustom && pathError ? <AdminInlineError>{pathError}</AdminInlineError> : null}
        <AdminFieldGrid columns={4}>
          <AdminField span={2}>
            <div className='flex items-center gap-2 sm:h-9'>
              <input
                id='website-qr-append-src'
                type='checkbox'
                className='h-4 w-4 rounded border-slate-300 text-slate-900'
                checked={appendSrcQuery}
                onChange={(event) => {
                  setAppendSrcQuery(event.target.checked);
                }}
                disabled={optionsDisabled}
              />
              <Label htmlFor='website-qr-append-src' className='mb-0 cursor-pointer font-normal'>
                Append <code className='rounded bg-slate-100 px-1 py-0.5 text-xs'>src</code> query parameter
              </Label>
            </div>
          </AdminField>
          {appendSrcQuery ? (
            <AdminField
              label='src value'
              htmlFor='website-qr-src-value'
              span={2}
              hint={
                <>
                  Adds <code className='rounded bg-slate-100 px-1'>?src=…</code> (or{' '}
                  <code className='rounded bg-slate-100 px-1'>&amp;src=…</code>) for attribution. Leave blank to
                  omit. Use lowercase letters, numbers, and hyphens only (same slug rules as site paths).
                </>
              }
            >
              <Input
                id='website-qr-src-value'
                value={srcQueryValue}
                onChange={(event) => setSrcQueryValue(sanitizePublicSiteSrcQueryInput(event.target.value))}
                placeholder='e.g. qr'
                disabled={optionsDisabled}
                autoComplete='off'
              />
            </AdminField>
          ) : null}
        </AdminFieldGrid>
        <PublicSiteQrExportPanel
          builtUrl={builtUrl && !pathError ? builtUrlForQr : ''}
          configError={configError}
          previewAriaLabel={`QR code preview for ${isTrainingSite ? 'training' : 'public'} page ${pathForAnalytics || '/'}`}
          downloadFilenameBase={downloadBase}
          downloadEvent='admin_public_page_qr_downloaded'
          analyticsParams={{
            public_site_path: pathForAnalytics,
            locale: isTrainingSite ? 'none' : locale,
            qr_site_target: siteTarget,
          }}
          previewUrlPresentation='referral'
        />
      </AdminEditorPanel>
    </Card>
  );
}
