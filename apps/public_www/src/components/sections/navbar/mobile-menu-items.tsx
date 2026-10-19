import Image from 'next/image';
import { useState } from 'react';

import { ButtonPrimitive } from '@/components/shared/button-primitive';
import enContent from '@/content/en.json';
import { type Locale, type NavbarContent } from '@/content';
import { formatContentTemplate } from '@/content/content-field-utils';
import {
  isHrefActive,
  isMenuItemActive,
} from '@/components/sections/navbar/navbar-utils';
import { localizeHref } from '@/lib/locale-routing';

type MenuItem = NavbarContent['menuItems'][number];
type SubmenuItem = NonNullable<MenuItem['children']>[number];

const NAV_SUBMENU_LINK_CLASSNAME = '';
const NAV_MOBILE_PILL_RESET_CLASSNAME = 'es-navbar-mobile-pill-reset';
const NAV_MOBILE_TOP_LEVEL_LINK_CLASSNAME =
  `w-full justify-start transition-colors ${NAV_MOBILE_PILL_RESET_CLASSNAME}`;
export const MOBILE_PRIMARY_ACTION_CLASSNAME =
  `w-full justify-between transition-colors ${NAV_MOBILE_PILL_RESET_CLASSNAME}`;
const NAV_MOBILE_CHEVRON_ICON_SRC = '/images/chevron.svg';

interface SubmenuLinksProps {
  items: readonly SubmenuItem[];
  currentPath: string;
  listClassName: string;
  linkClassName: string;
  locale: Locale;
  onNavigate?: () => void;
}

function SubmenuLinks({
  items,
  currentPath,
  listClassName,
  linkClassName,
  locale,
  onNavigate,
}: SubmenuLinksProps) {
  return (
    <ul className={listClassName}>
      {items.map((item) => (
        <li key={item.label}>
          <ButtonPrimitive
            variant='submenu'
            state={isHrefActive(currentPath, item.href) ? 'active' : 'inactive'}
            href={localizeHref(item.href, locale)}
            className={linkClassName}
            onClick={onNavigate}
          >
            {item.label}
          </ButtonPrimitive>
        </li>
      ))}
    </ul>
  );
}

function MobileMenuItem({
  item,
  currentPath,
  locale,
  onNavigate,
  submenuToggleLabelTemplate,
}: {
  item: MenuItem;
  currentPath: string;
  locale: Locale;
  onNavigate: () => void;
  submenuToggleLabelTemplate: string;
}) {
  const itemIsActive = isMenuItemActive(currentPath, item);
  const [isExpanded, setIsExpanded] = useState(itemIsActive);
  const [expandedForActive, setExpandedForActive] = useState(itemIsActive);
  if (itemIsActive !== expandedForActive) {
    setExpandedForActive(itemIsActive);
    setIsExpanded(itemIsActive);
  }

  return (
    <li className='space-y-2'>
      {item.children ? (
        <ButtonPrimitive
          variant='pill'
          state={itemIsActive ? 'active' : 'inactive'}
          onClick={() => {
            setIsExpanded((value) => !value);
          }}
          aria-expanded={isExpanded}
          aria-label={formatContentTemplate(submenuToggleLabelTemplate, {
            label: item.label,
          })}
          className={MOBILE_PRIMARY_ACTION_CLASSNAME}
        >
          <span>{item.label}</span>
          <span
            aria-hidden='true'
            className={`inline-flex h-4 w-4 items-center justify-center transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          >
            <Image
              src={NAV_MOBILE_CHEVRON_ICON_SRC}
              alt=''
              aria-hidden='true'
              width={16}
              height={16}
              className='h-4 w-4'
            />
          </span>
        </ButtonPrimitive>
      ) : (
        <ButtonPrimitive
          variant='pill'
          state={itemIsActive ? 'active' : 'inactive'}
          href={localizeHref(item.href, locale)}
          className={NAV_MOBILE_TOP_LEVEL_LINK_CLASSNAME}
          onClick={onNavigate}
        >
          {item.label}
        </ButtonPrimitive>
      )}
      {item.children && (
        <SubmenuLinks
          items={item.children}
          currentPath={currentPath}
          locale={locale}
          onNavigate={onNavigate}
          listClassName={`overflow-hidden pl-4 transition-all duration-300 ${isExpanded ? 'max-h-[480px] space-y-2 pt-1 opacity-100' : 'max-h-0 space-y-0 pt-0 opacity-0'}`}
          linkClassName={NAV_SUBMENU_LINK_CLASSNAME}
        />
      )}
    </li>
  );
}

export function MobileMenuItems({
  items,
  currentPath,
  locale,
  onNavigate,
  submenuToggleLabelTemplate = enContent.navbar.submenuToggleLabelTemplate,
}: {
  items: readonly MenuItem[];
  currentPath: string;
  locale: Locale;
  onNavigate: () => void;
  submenuToggleLabelTemplate?: string;
}) {
  return (
    <ul className='space-y-3'>
      {items.map((item) => (
        <MobileMenuItem
          key={item.label}
          item={item}
          currentPath={currentPath}
          locale={locale}
          onNavigate={onNavigate}
          submenuToggleLabelTemplate={submenuToggleLabelTemplate}
        />
      ))}
    </ul>
  );
}
