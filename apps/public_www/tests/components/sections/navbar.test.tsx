import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Navbar } from '@/components/sections/navbar';
import { MobileMenuItems } from '@/components/sections/navbar/mobile-menu-items';
import enContent from '@/content/en.json';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/events',
}));

vi.mock('next/image', () => ({
  default: function MockImage(props: ComponentProps<'img'>) {
    const {
      src,
      alt,
      ...rest
    } = props;
    return (
      <div
        data-next-image-src={typeof src === 'string' ? src : 'non-string-src'}
        data-next-image-alt={alt ?? ''}
        {...rest}
      />
    );
  },
}));

interface MockLinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  href: string;
  prefetch?: boolean;
  scroll?: boolean;
  children: ReactNode;
}

vi.mock('next/link', () => ({
  default: function MockLink({
    href,
    prefetch,
    scroll,
    children,
    ...props
  }: MockLinkProps) {
    return (
      <a
        href={href}
        data-prefetch={typeof prefetch === 'boolean' ? String(prefetch) : undefined}
        data-scroll={typeof scroll === 'boolean' ? String(scroll) : undefined}
        {...props}
      >
        {children}
      </a>
    );
  },
}));

describe('Navbar desktop submenu accessibility', () => {
  it('uses shared layout container class on desktop nav wrapper', () => {
    render(<Navbar content={enContent.navbar} />);

    const nav = screen.getByRole('navigation');
    expect(nav.className).toContain('es-layout-container');
    expect(nav.className).toContain('es-navbar-nav');
    expect(nav.className).toContain('pl-0');
    expect(nav.className).toContain('pr-4');
    expect(nav.className).toContain('sm:pr-6');
    expect(nav.className).toContain('lg:pr-8');
    expect(nav.className).toContain('py-0');
    expect(nav.className).not.toContain('sm:px-6');
    expect(nav.className).not.toContain('px-8 py-0');

    const header = document.querySelector('header[data-figma-node="navbar"]');
    expect(header?.className).toContain('es-navbar-surface');
    expect(header?.className).toContain('fixed');
    expect(header?.className).toContain('top-0');
    expect(header?.className).toContain('left-0');
    expect(header?.className).toContain('z-40');

    const spacer = document.querySelector('.es-navbar-offset');
    expect(spacer).not.toBeNull();
    expect(spacer?.getAttribute('aria-hidden')).toBe('true');

    const languageSelectors = screen.getAllByRole('button', {
      name: /Selected language: English/i,
    });
    const desktopLanguageSelector = languageSelectors.find((button) =>
      button.className.includes('self-center'),
    );
    expect(desktopLanguageSelector).toBeDefined();
    const languageSelectorWrapper = (
      desktopLanguageSelector as HTMLElement
    ).closest('div');
    expect(languageSelectorWrapper?.className).toContain('items-center');

    const desktopActionsContainer = document.querySelector(
      'div.hidden.items-center.lg\\:flex',
    );
    expect(desktopActionsContainer).not.toBeNull();
    const desktopBookNowLink = within(
      desktopActionsContainer as HTMLElement,
    ).getByRole('link', {
      name: enContent.navbar.bookNow.label,
    });
    expect(desktopBookNowLink).toBeInTheDocument();
    expect(desktopBookNowLink).toHaveAttribute(
      'href',
      '/en/book-a-free-call/#intro-call-booking',
    );
    expect(desktopBookNowLink).not.toHaveAttribute('data-scroll');

    const logoLink = header?.querySelector('a.shrink-0[href="/en/"]');
    expect(logoLink).not.toBeNull();
    expect(logoLink).toHaveAttribute('data-prefetch', 'false');
    expect(logoLink).toHaveAttribute('data-scroll', 'true');
  });

  it('applies active and inactive classes to language menu items', () => {
    render(<Navbar content={enContent.navbar} />);

    const languageSelectors = screen.getAllByRole('button', {
      name: /Selected language: English/i,
    });
    const desktopToggle = languageSelectors.find((button) =>
      button.className.includes('self-center'),
    );
    expect(desktopToggle).toBeDefined();
    fireEvent.click(desktopToggle as HTMLElement);

    const englishOption = screen.getByRole('menuitem', { name: /English/i });
    const simplifiedChineseOption = screen.getByRole('menuitem', {
      name: /简体中文/,
    });

    expect(englishOption.className).toContain('es-nav-language-option');
    expect(englishOption.className).toContain('es-nav-language-option--active');
    expect(simplifiedChineseOption.className).toContain('es-nav-language-option');
    expect(simplifiedChineseOption.className).toContain(
      'es-nav-language-option--inactive',
    );
  });

  it('restores focus to the submenu trigger before hiding links', () => {
    render(<Navbar content={enContent.navbar} />);

    const submenuToggle = screen.getByRole('button', {
      name: 'Toggle Our Services submenu',
    });
    fireEvent.click(submenuToggle);

    const submenuId = submenuToggle.getAttribute('aria-controls');
    expect(submenuId).toBeTruthy();

    const submenu = document.getElementById(submenuId as string);
    expect(submenu).not.toBeNull();
    expect(submenuToggle).toHaveAttribute('aria-expanded', 'true');
    expect(submenu).not.toHaveAttribute('aria-hidden', 'true');

    const submenuLink = within(submenu as HTMLElement).getByRole('link', {
      name: 'My Best Auntie Programme',
    });
    expect(
      within(submenu as HTMLElement).queryByRole('link', {
        name: 'Montessori Training',
      }),
    ).toBeNull();
    submenuLink.focus();
    expect(submenuLink).toHaveFocus();

    const submenuWrapper = submenuToggle.closest('li');
    expect(submenuWrapper).not.toBeNull();
    fireEvent.mouseLeave(submenuWrapper as HTMLElement);

    expect(submenuToggle).toHaveFocus();
    expect(submenuToggle).toHaveAttribute('aria-expanded', 'false');
    expect(submenu).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps training submenu open on first click after hover', () => {
    render(<Navbar content={enContent.navbar} />);

    const submenuToggle = screen.getByRole('button', {
      name: 'Toggle Our Services submenu',
    });
    const submenuWrapper = submenuToggle.closest('li');

    expect(submenuWrapper).not.toBeNull();
    fireEvent.mouseEnter(submenuWrapper as HTMLElement);
    expect(submenuToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(submenuToggle);
    expect(submenuToggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(submenuToggle);
    expect(submenuToggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('styles mobile navbar controls with language selector in drawer', async () => {
    render(<Navbar content={enContent.navbar} />);

    const openMenuButton = screen.getByRole('button', {
      name: /Open navigation menu/i,
    });
    expect(openMenuButton.className).toContain('es-border-soft');
    expect(openMenuButton.className).toContain('bg-[#F6DECD]');
    const mobileControlsContainer = openMenuButton.closest('div');
    expect(mobileControlsContainer).toHaveAttribute(
      'data-css-fallback',
      'hide-when-css-missing',
    );
    const mobileTopBarCta = within(mobileControlsContainer as HTMLElement).getByRole(
      'link',
      {
        name: enContent.navbar.bookNow.label,
      },
    );
    expect(mobileTopBarCta).toBeInTheDocument();
    expect(mobileTopBarCta.className).not.toContain('text-xs');

    fireEvent.click(openMenuButton);

    const drawer = await screen.findByRole('dialog', {
      name: /Mobile navigation menu/i,
    });
    const drawerLanguageSelector = within(drawer).getByRole('button', {
      name: /Selected language: English/i,
    });
    expect(drawerLanguageSelector).toBeInTheDocument();
    expect(drawerLanguageSelector.className).toContain('es-border-soft');

    const drawerCta = within(drawer).getByRole('link', {
      name: enContent.navbar.bookNow.label,
    });
    expect(drawerCta).toBeInTheDocument();
    expect(drawerCta.className).toContain('w-full');

    const homeLink = within(drawer).getByRole('link', { name: 'Home' });
    expect(homeLink.className).toContain('es-navbar-mobile-pill-reset');
    expect(homeLink.className).toContain('w-full');
    expect(homeLink.className).toContain('justify-start');

    const drawerLogoLink = drawer.querySelector('a.shrink-0[href="/en/"]');
    expect(drawerLogoLink).not.toBeNull();
    expect(drawerLogoLink).toHaveAttribute('data-prefetch', 'false');
    expect(drawerLogoLink).toHaveAttribute('data-scroll', 'true');

    const trainingCoursesToggle = within(drawer).getByRole('button', {
      name: 'Toggle Our Services submenu',
    });
    expect(trainingCoursesToggle.className).toContain('es-navbar-mobile-pill-reset');
  });

  it('follows the active path when expanding the mobile submenu', () => {
    const { rerender } = render(
      <MobileMenuItems
        items={enContent.navbar.menuItems}
        currentPath='/services/consultations'
        locale='en'
        onNavigate={() => undefined}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Toggle Our Services submenu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <MobileMenuItems
        items={enContent.navbar.menuItems}
        currentPath='/about-us'
        locale='en'
        onNavigate={() => undefined}
      />,
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <MobileMenuItems
        items={enContent.navbar.menuItems}
        currentPath='/services/consultations'
        locale='en'
        onNavigate={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Toggle Our Services submenu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('condenses fixed navbar after scrolling via DOM class toggle', async () => {
    render(<Navbar content={enContent.navbar} />);

    const header = document.querySelector('header[data-figma-node="navbar"]');
    expect(header?.className).not.toContain('es-navbar--condensed');

    const nav = screen.getByRole('navigation');
    expect(nav.className).toContain('es-navbar-nav');

    Object.defineProperty(window, 'scrollY', {
      value: 120,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(header?.className).toContain('es-navbar--condensed');
    });
  });

  it('keeps navbar condensed until user scrolls back to top (hysteresis)', async () => {
    render(<Navbar content={enContent.navbar} />);

    const header = document.querySelector('header[data-figma-node="navbar"]');

    Object.defineProperty(window, 'scrollY', {
      value: 60,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(header?.className).toContain('es-navbar--condensed');
    });

    Object.defineProperty(window, 'scrollY', { value: 10, writable: true, configurable: true });
    fireEvent.scroll(window);
    await waitFor(() => {
      expect(header?.className).toContain('es-navbar--condensed');
    });

    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    fireEvent.scroll(window);
    await waitFor(() => {
      expect(header?.className).not.toContain('es-navbar--condensed');
    });
  });
});
