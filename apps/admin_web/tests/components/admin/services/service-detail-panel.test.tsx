import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceDetailPanel } from '@/components/admin/services/service-detail-panel';
import * as servicesApi from '@/lib/services-api';
import type { ServiceDetail } from '@/types/services';

function buildService(overrides: Partial<ServiceDetail> = {}): ServiceDetail {
  return {
    id: 'service-1',
    instancesCount: 0,
    serviceType: 'training_course',
    title: 'Alpha service',
    serviceKey: null,
    bookingSystem: null,
    description: 'Alpha description',
    coverImageS3Key: null,
    deliveryMode: 'online',
    status: 'draft',
    serviceTier: null,
    locationId: null,
    createdBy: 'admin',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    tagIds: [],
    assetIds: [],
    trainingDetails: {
      pricingUnit: 'per_person',
      defaultPrice: null,
      defaultCurrency: null,
    },
    eventDetails: null,
    consultationDetails: null,
    ...overrides,
  };
}

describe('ServiceDetailPanel', () => {
  beforeEach(() => {
    vi.spyOn(servicesApi, 'getServiceDiscountCodeUsageSummary').mockResolvedValue({
      summary: { totalCurrentUses: 0, referencingCodeCount: 0 },
      error: null,
    });
  });

  it('prefills create form from createPrefillFromService with draft title suffix and copied slug', async () => {
    const template = buildService({
      title: 'Original',
      serviceKey: 'original-slug',
      status: 'published',
      serviceTier: 'tier-a',
      trainingDetails: {
        pricingUnit: 'per_family',
        defaultPrice: '88',
        defaultCurrency: 'USD',
      },
    });

    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        createPrefillFromService={template}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('Original (copy)');
    });
    expect(screen.getByLabelText('Service tier')).toHaveValue('tier-a');
    expect(screen.getByLabelText('Service key')).toHaveValue('original-slug');
    expect(screen.getByLabelText('Status')).toHaveValue('draft');
    expect(screen.getByLabelText('Pricing unit')).toHaveValue('per_family');
    expect(screen.getByLabelText('Default price')).toHaveValue('88');
    expect(screen.getByLabelText('Currency')).toHaveValue('USD');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a draft warning icon next to the service status field label when status is draft', () => {
    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService({ status: 'draft' })}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'Draft — not published to the website' })).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('draft');
  });

  it('initializes form values from service props per mount', () => {
    const onUpdate = vi.fn();
    const onCreate = vi.fn();
    const onUploadCover = vi.fn();

    const { rerender } = render(
      <ServiceDetailPanel
        mode='create'
        key='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={onUpdate}
        onUploadCover={onUploadCover}
      />
    );

    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('draft');
    expect(screen.getByLabelText('Cover file name')).toHaveValue('');
    expect(screen.getByLabelText('Cover file name')).toHaveAttribute('placeholder', 'e.g. media-cover.jpg');
    expect(screen.getByLabelText('Booking system')).toHaveAttribute('placeholder', 'e.g. training-booking');
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('placeholder');
    expect(screen.getByLabelText('Description')).not.toHaveAttribute('placeholder');

    rerender(
      <ServiceDetailPanel
        mode='edit'
        key='service-1'
        service={buildService()}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={onUpdate}
        onUploadCover={onUploadCover}
      />
    );

    expect(screen.getByLabelText('Title')).toHaveValue('Alpha service');
    expect(screen.getByLabelText('Description')).toHaveValue('Alpha description');
    expect(screen.getByLabelText('Status')).toHaveValue('draft');

    rerender(
      <ServiceDetailPanel
        mode='edit'
        key='service-2'
        service={buildService({
          id: 'service-2',
          title: 'Beta service',
          description: 'Beta description',
          status: 'published',
        })}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={onUpdate}
        onUploadCover={onUploadCover}
      />
    );

    expect(screen.getByLabelText('Title')).toHaveValue('Beta service');
    expect(screen.getByLabelText('Description')).toHaveValue('Beta description');
    expect(screen.getByLabelText('Status')).toHaveValue('published');

    rerender(
      <ServiceDetailPanel
        mode='create'
        key='create-again'
        service={null}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={onUpdate}
        onUploadCover={onUploadCover}
      />
    );

    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('draft');
  });

  it('keeps service type visible and read-only in edit mode', () => {
    const onUpdate = vi.fn();
    const onCreate = vi.fn();
    const onUploadCover = vi.fn();

    const { rerender } = render(
      <ServiceDetailPanel
        mode='create'
        key='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={onUpdate}
        onUploadCover={onUploadCover}
      />
    );

    const createModeServiceType = screen.getByLabelText('Type');
    expect(createModeServiceType).toBeEnabled();

    rerender(
      <ServiceDetailPanel
        mode='edit'
        key='edit'
        service={buildService({
          serviceType: 'consultation',
        })}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={onUpdate}
        onUploadCover={onUploadCover}
      />
    );

    const editModeServiceType = screen.getByLabelText('Type');
    expect(editModeServiceType).toBeDisabled();
    expect(editModeServiceType).toHaveValue('consultation');
  });

  it('lays out event fields: Row1 delivery/tier/booking/cover; Row2 category/price/currency/location', async () => {
    const user = userEvent.setup();

    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Type'), 'event');

    const delivery = screen.getByLabelText('Delivery mode');
    const tier = screen.getByLabelText('Service tier');
    const booking = screen.getByLabelText('Booking system');
    const cover = screen.getByLabelText('Cover file name');
    expect(delivery.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tier.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(booking.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const category = screen.getByLabelText('Event category');
    const defaultPrice = screen.getByLabelText('Default price');
    const currency = screen.getByLabelText('Currency');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    const location = screen.getByLabelText('Default location');
    expect(category.compareDocumentPosition(defaultPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(defaultPrice.compareDocumentPosition(currency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(currency.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.queryAllByLabelText('Booking system')).toHaveLength(1);
    expect(screen.queryByText('Pricing unit')).not.toBeInTheDocument();
  });

  it('labels training course default amount as Default price', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');

    expect(screen.getByLabelText('Default price')).toBeInTheDocument();
  });

  it('shows consultation fields without Calendly; max group size after group format', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'consultation');
    expect(screen.getByLabelText('Duration (minutes)')).toHaveValue('');
    expect(screen.getByLabelText('Duration (minutes)')).toHaveAttribute('placeholder', 'e.g. 60');
    expect(screen.getByLabelText('Consultation format')).toBeInTheDocument();
    expect(screen.getByLabelText('Pricing model')).toBeInTheDocument();
    expect(screen.queryByLabelText('Max group size')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Consultation format'), 'group');
    expect(screen.getByLabelText('Max group size')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Calendly/i)).not.toBeInTheDocument();
  });

  it('places service tier before default price for training and submits service_tier', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');
    await user.type(screen.getByLabelText('Title'), 'T');
    const tierInputs = screen.getAllByLabelText('Service tier');
    await user.type(tierInputs[0], 'ages-3-5');
    await user.type(screen.getByLabelText('Default price'), '100');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    await user.click(screen.getByRole('button', { name: /Create service/i }));
    expect(onCreate).toHaveBeenCalled();
    const body = onCreate.mock.calls[0][0] as { service_tier?: string | null };
    expect(body.service_tier).toBe('ages-3-5');
    const defaultPrice = screen.getByLabelText('Default price');
    expect(tierInputs[0].compareDocumentPosition(defaultPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const defaultLocation = screen.getByLabelText('Default location');
    expect(defaultPrice.compareDocumentPosition(defaultLocation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('places service tier before default price for event and submits service_tier', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'event');
    await user.type(screen.getByLabelText('Title'), 'E');
    const tierInputs = screen.getAllByLabelText('Service tier');
    await user.type(tierInputs[0], 'spring-tier');
    await user.type(screen.getByLabelText('Default price'), '50');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    await user.click(screen.getByRole('button', { name: /Create service/i }));
    expect(onCreate).toHaveBeenCalled();
    const body = onCreate.mock.calls[0][0] as { service_tier?: string | null };
    expect(body.service_tier).toBe('spring-tier');
    const defaultPrice = screen.getByLabelText('Default price');
    expect(tierInputs[0].compareDocumentPosition(defaultPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const defaultLocation = screen.getByLabelText('Default location');
    expect(defaultPrice.compareDocumentPosition(defaultLocation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('warns and disables save when publishing an event without a service key', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService({
          serviceType: 'event',
          status: 'draft',
          serviceKey: null,
          eventDetails: {
            eventCategory: 'workshop',
            defaultPrice: '10',
            defaultCurrency: 'HKD',
          },
        })}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onUploadCover={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Status'), 'Published');
    expect(
      screen.getByText(
        'A service key is required to take public bookings (discount validation and reservation submission). Set one before publishing.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update service/i })).toBeDisabled();
  });

  it('enables update when published event has a valid service key', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='edit'
        service={buildService({
          serviceType: 'event',
          status: 'published',
          serviceKey: 'spring-workshop',
          eventDetails: {
            eventCategory: 'workshop',
            defaultPrice: '10',
            defaultCurrency: 'HKD',
          },
        })}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(
        'A service key is required to take public bookings (discount validation and reservation submission). Set one before publishing.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update service/i })).toBeEnabled();
    await user.clear(screen.getByLabelText('Service key'));
    await user.type(screen.getByLabelText('Service key'), 'new-event-key');
    expect(screen.getByRole('button', { name: /Update service/i })).toBeEnabled();
  });

  it('consultation shows currency when hourly and a service tier field in Row1', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'consultation');
    expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Pricing model'), 'hourly');
    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(document.getElementById('service-tier-consultation')).not.toBeNull();
  });

  it('submits location_id when a default location is selected', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[
          {
            id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            name: 'Venue A',
            areaId: 'a',
            address: null,
            lat: null,
            lng: null,
            createdAt: null,
            updatedAt: null,
            lockedFromPartnerOrg: false,
            partnerOrganizationLabels: [],
            partnerOrganizationIds: [],
          },
        ]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');
    await user.type(screen.getByLabelText('Title'), 'T');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    await user.selectOptions(screen.getByLabelText('Default location'), '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    await user.type(screen.getByLabelText('Default price'), '10');
    await user.click(screen.getByRole('button', { name: /Create service/i }));
    expect(onCreate).toHaveBeenCalled();
    const body = onCreate.mock.calls[0][0] as { location_id?: string | null };
    expect(body.location_id).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });

  it('shows UUID input when location list is empty and not loading, submits typed location_id', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');
    await user.type(screen.getByLabelText('Title'), 'T');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    const locInput = screen.getByPlaceholderText('Location UUID');
    expect(locInput).toBeInTheDocument();
    await user.type(locInput, uuid);
    await user.type(screen.getByLabelText('Default price'), '10');
    await user.click(screen.getByRole('button', { name: /Create service/i }));
    expect(onCreate).toHaveBeenCalled();
    const body = onCreate.mock.calls[0][0] as { location_id?: string | null };
    expect(body.location_id).toBe(uuid);
  });

  it('lays out training Row1/Row2 with expected fields and order', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');

    const delivery = screen.getByLabelText('Delivery mode');
    const tier = screen.getByLabelText('Service tier');
    const booking = screen.getByLabelText('Booking system');
    const cover = screen.getByLabelText('Cover file name');
    expect(delivery.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tier.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(booking.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const pricingUnit = screen.getByLabelText('Pricing unit');
    const defaultPrice = screen.getByLabelText('Default price');
    const currency = screen.getByLabelText('Currency');
    const location = screen.getByLabelText('Default location');
    expect(pricingUnit.compareDocumentPosition(defaultPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(defaultPrice.compareDocumentPosition(currency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(currency.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lays out consultation Row1 with delivery, tier, booking, cover; format after pricing on row with duration', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'consultation');

    const delivery = screen.getByLabelText('Delivery mode');
    const tier = document.getElementById('service-tier-consultation');
    expect(tier).not.toBeNull();
    const booking = screen.getByLabelText('Booking system');
    const cover = screen.getByLabelText('Cover file name');
    expect(delivery.compareDocumentPosition(tier!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tier!.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(booking.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const pricingModel = screen.getByLabelText('Pricing model');
    const format = screen.getByLabelText('Consultation format');
    const duration = screen.getByLabelText('Duration (minutes)');
    expect(cover.compareDocumentPosition(pricingModel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pricingModel.compareDocumentPosition(format) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(format.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('consultation pricing free hides price/currency/package sessions', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'consultation');
    await user.selectOptions(screen.getByLabelText('Pricing model'), 'free');
    expect(screen.queryByLabelText('Hourly rate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Package price')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Package sessions')).not.toBeInTheDocument();
  });

  it('consultation pricing hourly shows hourly rate and currency; hides package fields', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'consultation');
    await user.selectOptions(screen.getByLabelText('Pricing model'), 'hourly');
    expect(screen.getByLabelText('Hourly rate')).toBeInTheDocument();
    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(screen.queryByLabelText('Package price')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Package sessions')).not.toBeInTheDocument();
  });

  it('consultation pricing package shows package price, currency, sessions; hides hourly', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'consultation');
    await user.selectOptions(screen.getByLabelText('Pricing model'), 'package');
    expect(screen.getByLabelText('Package price')).toBeInTheDocument();
    expect(screen.getByLabelText('Currency')).toBeInTheDocument();
    expect(screen.getByLabelText('Package sessions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Hourly rate')).not.toBeInTheDocument();
  });

  it('hides default location when delivery mode is Online for all service types', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[
          {
            id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            name: 'Venue A',
            areaId: 'a',
            address: null,
            lat: null,
            lng: null,
            createdAt: null,
            updatedAt: null,
            lockedFromPartnerOrg: false,
            partnerOrganizationLabels: [],
            partnerOrganizationIds: [],
          },
        ]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );

    for (const typeLabel of ['training_course', 'event', 'consultation', 'intro_call'] as const) {
      await user.selectOptions(screen.getByLabelText('Type'), typeLabel);
      await user.selectOptions(screen.getByLabelText('Delivery mode'), 'Online');
      expect(screen.queryByLabelText('Default location')).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
      expect(screen.getByLabelText('Default location')).toBeInTheDocument();
    }
  });

  it('clears default location and submits null when switching to Online before save', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');
    await user.type(screen.getByLabelText('Title'), 'T');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    await user.type(screen.getByPlaceholderText('Location UUID'), '550e8400-e29b-41d4-a716-446655440000');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'Online');
    expect(screen.queryByLabelText('Default location')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Default price'), '10');
    await user.click(screen.getByRole('button', { name: /Create service/i }));
    const body = onCreate.mock.calls[0][0] as { location_id?: string | null };
    expect(body.location_id).toBeNull();
  });

  it('default location select uses Select location placeholder', async () => {
    const user = userEvent.setup();
    render(
      <ServiceDetailPanel
        mode='create'
        service={null}
        locationOptions={[
          {
            id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
            name: 'Venue A',
            areaId: 'a',
            address: null,
            lat: null,
            lng: null,
            createdAt: null,
            updatedAt: null,
            lockedFromPartnerOrg: false,
            partnerOrganizationLabels: [],
            partnerOrganizationIds: [],
          },
        ]}
        isLoadingLocations={false}
        isSaving={false}
        error=''
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onUploadCover={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'training_course');
    await user.selectOptions(screen.getByLabelText('Delivery mode'), 'In Person');
    const select = screen.getByLabelText('Default location') as HTMLSelectElement;
    const placeholder = Array.from(select.options).find((o) => o.value === '');
    expect(placeholder?.textContent).toBe('Select location');
    expect(placeholder?.textContent).not.toContain('optional');
  });
});
