'use client';

import { useEffect, useState } from 'react';

import type { AdminAsset } from '@/types/assets';

import {
  getAdminAssetShareLink,
  getOrCreateAdminAssetShareLink,
  revokeAdminAssetShareLink,
  rotateAdminAssetShareLink,
  type AssetShareLink,
} from '@/lib/assets-api';
import { copyTextToClipboard } from '@/lib/clipboard';

import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useCopyFeedback } from '@/hooks/use-copy-feedback';
import { StatusBanner } from '@/components/status-banner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_ALLOWED_SHARE_DOMAINS = '';

function parseAllowedDomainList(input: string): string[] {
  const rawEntries = input
    .split(/[\n,]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  const uniqueEntries = Array.from(new Set(rawEntries));
  if (uniqueEntries.length === 0) {
    throw new Error('Add at least one allowed domain before creating or rotating a share link.');
  }
  return uniqueEntries;
}

export function AssetShareLinkSection({ selectedAsset }: { selectedAsset: AdminAsset }) {
  const [confirmDialogProps, requestConfirm] = useConfirmDialog();
  const [isCopyingLink, setIsCopyingLink] = useState(false);
  const [isRotatingLink, setIsRotatingLink] = useState(false);
  const [isRevokingLink, setIsRevokingLink] = useState(false);
  const [isSavingLinkPolicy, setIsSavingLinkPolicy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkNotice, setLinkNotice] = useState('');
  const [allowedDomainsInput, setAllowedDomainsInput] = useState<string>(
    DEFAULT_ALLOWED_SHARE_DOMAINS
  );
  const { copiedKey: copiedLinkFeedbackKey, markCopied: markShareLinkCopied } = useCopyFeedback(1000);

  useEffect(() => {
    let isCancelled = false;

    const loadShareLinkPolicy = async () => {
      try {
        const existingShareLink = await getAdminAssetShareLink(selectedAsset.id);
        if (isCancelled) {
          return;
        }
        if (existingShareLink?.allowedDomains.length) {
          setAllowedDomainsInput(existingShareLink.allowedDomains.join('\n'));
        } else {
          setAllowedDomainsInput(DEFAULT_ALLOWED_SHARE_DOMAINS);
        }
      } catch {
        if (isCancelled) {
          return;
        }
        setAllowedDomainsInput(DEFAULT_ALLOWED_SHARE_DOMAINS);
      }
    };

    void loadShareLinkPolicy();
    return () => {
      isCancelled = true;
    };
  }, [selectedAsset.id]);

  const buildSharePolicyInput = () => ({
    allowedDomains: parseAllowedDomainList(allowedDomainsInput),
  });

  const applyShareLinkCopiedUi = async (link: AssetShareLink) => {
    try {
      await copyTextToClipboard(link.shareUrl);
      if (link.allowedDomains.length > 0) {
        setAllowedDomainsInput(link.allowedDomains.join('\n'));
      }
      setLinkError('');
      markShareLinkCopied(selectedAsset.id);
    } catch (error) {
      setLinkError(
        error instanceof Error ? error.message : 'Unable to copy the link to clipboard.'
      );
    }
  };

  const handleCopyAssetLink = async () => {
    setIsCopyingLink(true);
    setLinkError('');
    setLinkNotice('');
    try {
      const policyInput = buildSharePolicyInput();
      const link = await getOrCreateAdminAssetShareLink(selectedAsset.id, policyInput);
      await applyShareLinkCopiedUi(link);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Unable to copy the link to clipboard.');
    } finally {
      setIsCopyingLink(false);
    }
  };

  const handleRotateAssetLink = async () => {
    const confirmed = await requestConfirm({
      title: 'Rotate share link',
      description: 'Rotate this share link? Previously copied links will stop working.',
      confirmLabel: 'Rotate',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }

    setIsRotatingLink(true);
    setLinkError('');
    setLinkNotice('');
    try {
      const policyInput = buildSharePolicyInput();
      const link = await rotateAdminAssetShareLink(selectedAsset.id, policyInput);
      await applyShareLinkCopiedUi(link);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Unable to rotate and copy the share link.');
    } finally {
      setIsRotatingLink(false);
    }
  };

  const handleSaveLinkPolicy = async () => {
    setIsSavingLinkPolicy(true);
    setLinkError('');
    setLinkNotice('');
    try {
      const policyInput = buildSharePolicyInput();
      const link = await getOrCreateAdminAssetShareLink(selectedAsset.id, policyInput);
      if (link.allowedDomains.length > 0) {
        setAllowedDomainsInput(link.allowedDomains.join('\n'));
      }
      setLinkNotice('Share-link domain policy saved.');
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Unable to save link domain policy.');
    } finally {
      setIsSavingLinkPolicy(false);
    }
  };

  const handleRevokeAssetLink = async () => {
    const confirmed = await requestConfirm({
      title: 'Revoke share link',
      description: 'Revoke this share link? Anyone with the current link will lose access.',
      confirmLabel: 'Revoke',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) {
      return;
    }

    setIsRevokingLink(true);
    setLinkError('');
    setLinkNotice('');
    try {
      await revokeAdminAssetShareLink(selectedAsset.id);
      setLinkNotice('Share link revoked.');
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Unable to revoke the share link.');
    } finally {
      setIsRevokingLink(false);
    }
  };

  const areLinkButtonsDisabled =
    isCopyingLink || isRotatingLink || isRevokingLink || isSavingLinkPolicy;

  const isLinkCopied = copiedLinkFeedbackKey === selectedAsset.id;

  return (
    <>
      <div className='space-y-4'>
        {linkError ? (
          <StatusBanner variant='error' title='Asset link'>
            {linkError}
          </StatusBanner>
        ) : null}
        {linkNotice ? <StatusBanner variant='success'>{linkNotice}</StatusBanner> : null}

        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant={isLinkCopied ? 'success' : 'secondary'}
            disabled={areLinkButtonsDisabled}
            loading={isCopyingLink}
            loadingLabel='Copying…'
            onClick={() => void handleCopyAssetLink()}
          >
            {isLinkCopied ? 'Link copied' : 'Copy link'}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => void handleRotateAssetLink()}
            disabled={areLinkButtonsDisabled}
            loading={isRotatingLink}
            loadingLabel='Refreshing…'
          >
            Refresh
          </Button>
          <Button
            type='button'
            size='sm'
            variant='danger'
            onClick={() => void handleRevokeAssetLink()}
            disabled={areLinkButtonsDisabled}
            loading={isRevokingLink}
            loadingLabel='Deleting…'
          >
            Delete links
          </Button>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='asset-share-allowed-domains'>Share-link domain allowlist</Label>
          <Textarea
            id='asset-share-allowed-domains'
            rows={3}
            value={allowedDomainsInput}
            onChange={(event) => setAllowedDomainsInput(event.target.value)}
            placeholder='example.com'
          />
          <div className='flex justify-start'>
            <Button
              type='button'
              size='sm'
              variant='secondary'
              onClick={() => void handleSaveLinkPolicy()}
              disabled={areLinkButtonsDisabled}
              loading={isSavingLinkPolicy}
              loadingLabel='Saving…'
            >
              Save policy
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
