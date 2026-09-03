"use client";

import { WarningTriangleIcon } from "@/components/icons/action-icons";
import { AdminFieldGrid } from "@/components/ui/admin-field-grid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatEnumLabel, formatServiceTitleWithTier } from "@/lib/format";
import { formatInstanceLocationOptionLabel } from "@/lib/instance-location-options";
import { INSTANCE_SLUG_PATTERN } from "@/lib/slug-utils";

import { INSTANCE_STATUSES, SERVICE_DELIVERY_MODES } from "@/types/services";
import type {
  InstanceStatus,
  LocationSummary,
  PartnerOrgRef,
  ServiceDeliveryMode,
  ServiceSummary,
} from "@/types/services";

import type { SessionSlotFormRow } from "@/types/services";

export { INSTANCE_SLUG_PATTERN } from "@/lib/slug-utils";

export interface InstanceInstructorOption {
  sub: string;
  email: string | null;
  name: string | null;
}

export interface InstanceFormState {
  title: string;
  slug: string;
  description: string;
  status: InstanceStatus;
  deliveryMode: ServiceDeliveryMode | "";
  locationId: string;
  maxCapacity: string;
  capacityLeftOverride: string;
  waitlistEnabled: boolean;
  instructorId: string;
  cohort: string;
  notes: string;
  externalUrl: string;
  partnerOrganizations: PartnerOrgRef[];
  sessionSlots: SessionSlotFormRow[];
}

export interface InstanceFormFieldsProps {
  value: InstanceFormState;
  serviceId?: string | null;
  /** Service default location; used to show the correct option when the form `locationId` is still empty. */
  serviceLocationId?: string | null;
  serviceOptions?: ServiceSummary[];
  locationOptions?: LocationSummary[];
  isLoadingLocations?: boolean;
  instructorOptions?: InstanceInstructorOption[];
  isLoadingInstructors?: boolean;
  onSelectService?: (serviceId: string | null) => void;
  /** Show the (unchangeable) parent service as a read-only field; used while editing a saved instance. */
  serviceReadOnly?: boolean;
  onChange: (value: InstanceFormState) => void;
  /** Inline message under the slug field (for example submit validation or API field errors). */
  slugFieldError?: string;
}

function getInstructorOptionLabel(entry: InstanceInstructorOption): string {
  const name = entry.name?.trim();
  if (name) {
    return name;
  }
  const email = entry.email?.trim();
  if (email) {
    return email;
  }
  return entry.sub;
}

export interface InstanceInstructorFieldProps {
  value: string;
  disabled?: boolean;
  className?: string;
  instructorOptions?: InstanceInstructorOption[];
  isLoadingInstructors?: boolean;
  onChange: (instructorId: string) => void;
}

/** Instructor select for instance flows; composed in instance detail Row D. */
export function InstanceInstructorField({
  value,
  disabled = false,
  className,
  instructorOptions = [],
  isLoadingInstructors = false,
  onChange,
}: InstanceInstructorFieldProps) {
  const instructorExists = instructorOptions.some(
    (entry) => entry.sub === value,
  );
  return (
    <div className={className}>
      <Label htmlFor="instance-instructor-id">Instructor</Label>
      <Select
        id="instance-instructor-id"
        value={value}
        disabled={disabled || isLoadingInstructors}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {isLoadingInstructors ? "Loading instructors..." : "None"}
        </option>
        {value.trim() && !instructorExists ? (
          <option value={value}>{value}</option>
        ) : null}
        {instructorOptions.map((entry) => (
          <option key={entry.sub} value={entry.sub}>
            {getInstructorOptionLabel(entry)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function InstanceFormFields({
  value,
  serviceId = null,
  serviceLocationId = null,
  serviceOptions = [],
  locationOptions = [],
  isLoadingLocations = false,
  instructorOptions = [],
  isLoadingInstructors = false,
  onSelectService,
  serviceReadOnly = false,
  onChange,
  slugFieldError = "",
}: InstanceFormFieldsProps) {
  const canSelectService = Boolean(onSelectService);
  const selectedServiceOption =
    serviceOptions.find((entry) => entry.id === serviceId) ?? null;
  const serviceExists = selectedServiceOption !== null;
  const effectiveLocationId = value.locationId || (serviceLocationId ?? "");
  const locationExists = locationOptions.some(
    (entry) => entry.id === effectiveLocationId,
  );
  const selectedLocationValue = locationExists
    ? effectiveLocationId
    : effectiveLocationId || "";
  const hasLocationOptions = locationOptions.length > 0;
  const instanceFieldsLocked = canSelectService && !serviceId;
  const cohortTrimmed = value.cohort.trim().toLowerCase();
  const cohortInvalid =
    Boolean(cohortTrimmed) && !INSTANCE_SLUG_PATTERN.test(cohortTrimmed);
  const slugTrimmed = value.slug.trim().toLowerCase();
  const slugPatternInvalid =
    Boolean(slugTrimmed) && !INSTANCE_SLUG_PATTERN.test(slugTrimmed);
  const maxCapTrimmed = value.maxCapacity.trim();
  const capacityOverrideDisabled = instanceFieldsLocked || !maxCapTrimmed;

  return (
    <div className="space-y-4">
      <AdminFieldGrid columns={4}>
        {!canSelectService && serviceReadOnly ? (
          <div>
            <Label htmlFor="instance-service-id">Service</Label>
            <Input
              id="instance-service-id"
              value={
                selectedServiceOption
                  ? formatServiceTitleWithTier(
                      selectedServiceOption.title,
                      selectedServiceOption.serviceTier,
                    )
                  : (serviceId ?? "")
              }
              readOnly
              aria-readonly
            />
          </div>
        ) : null}
        {canSelectService ? (
          <div>
            <Label htmlFor="instance-service-id">Service</Label>
            <Select
              id="instance-service-id"
              value={serviceId && serviceExists ? serviceId : ""}
              onChange={(event) =>
                onSelectService?.(event.target.value || null)
              }
            >
              <option value="">Select service</option>
              {serviceId && !serviceExists ? (
                <option value={serviceId}>{serviceId}</option>
              ) : null}
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {formatServiceTitleWithTier(
                    service.title,
                    service.serviceTier,
                  )}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div>
          <Label htmlFor="instance-title">Title</Label>
          <Input
            id="instance-title"
            value={value.title}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({ ...value, title: event.target.value })
            }
            placeholder="Leave empty to inherit from service"
          />
        </div>
        <div>
          <Label htmlFor="instance-cohort">Cohort</Label>
          <Input
            id="instance-cohort"
            value={value.cohort}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({ ...value, cohort: event.target.value })
            }
            onBlur={() =>
              onChange({ ...value, cohort: value.cohort.trim().toLowerCase() })
            }
            placeholder="e.g. spring-2026"
            autoComplete="off"
          />
          {cohortInvalid ? (
            <p className="mt-1 text-xs text-red-600">
              Use lowercase letters and numbers, with single hyphens between
              segments (no leading or trailing hyphen).
            </p>
          ) : null}
        </div>
        <div>
          <div className="relative mb-1">
            <Label htmlFor="instance-status" className="mb-0 block pr-7">
              Status
            </Label>
            {value.status === "scheduled" ? (
              <span
                className="absolute right-0 top-1/2 inline-flex -translate-y-1/2 text-amber-600"
                role="img"
                aria-label="Scheduled — not yet open for booking"
                title="Scheduled — not yet open for booking"
              >
                <WarningTriangleIcon className="h-4 w-4" aria-hidden />
              </span>
            ) : null}
          </div>
          <Select
            id="instance-status"
            value={value.status}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({
                ...value,
                status: event.target.value as InstanceStatus,
              })
            }
          >
            {INSTANCE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnumLabel(entry)}
              </option>
            ))}
          </Select>
        </div>
      </AdminFieldGrid>
      <AdminFieldGrid columns={1}>
        <div>
          <Label htmlFor="instance-description">Description</Label>
          <Textarea
            id="instance-description"
            value={value.description}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({ ...value, description: event.target.value })
            }
            rows={2}
            placeholder="Leave empty to inherit from service"
          />
        </div>
      </AdminFieldGrid>
      <AdminFieldGrid columns={4}>
        <div className="sm:col-span-2">
          <Label htmlFor="instance-slug">
            Slug
            <span className="text-red-600" aria-hidden>
              {" "}
              *
            </span>
          </Label>
          <Input
            id="instance-slug"
            value={value.slug}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({ ...value, slug: event.target.value })
            }
            onBlur={() =>
              onChange({ ...value, slug: value.slug.trim().toLowerCase() })
            }
            placeholder="e.g. spring-workshop-2026-04-20"
            autoComplete="off"
          />
          {slugPatternInvalid ? (
            <p className="mt-1 text-xs text-red-600">
              Use lowercase letters, digits, and single hyphens between segments
              (no leading or trailing hyphen).
            </p>
          ) : null}
          {slugFieldError ? (
            <p className="mt-1 text-xs text-red-600">{slugFieldError}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="instance-delivery-mode">Delivery mode</Label>
          <Select
            id="instance-delivery-mode"
            value={value.deliveryMode}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({
                ...value,
                deliveryMode: event.target.value as ServiceDeliveryMode | "",
              })
            }
          >
            <option value="">Inherit from service</option>
            {SERVICE_DELIVERY_MODES.map((entry) => (
              <option key={entry} value={entry}>
                {formatEnumLabel(entry)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="instance-location-id">Location</Label>
          {hasLocationOptions || isLoadingLocations ? (
            <Select
              id="instance-location-id"
              value={selectedLocationValue}
              disabled={instanceFieldsLocked}
              onChange={(event) =>
                onChange({ ...value, locationId: event.target.value })
              }
            >
              <option value="">
                {isLoadingLocations
                  ? "Loading locations..."
                  : "Select location"}
              </option>
              {effectiveLocationId && !locationExists ? (
                <option value={effectiveLocationId}>
                  {effectiveLocationId}
                </option>
              ) : null}
              {locationOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {formatInstanceLocationOptionLabel(location)}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="instance-location-id"
              value={effectiveLocationId}
              disabled={instanceFieldsLocked}
              onChange={(event) =>
                onChange({ ...value, locationId: event.target.value })
              }
              placeholder="Location UUID"
            />
          )}
        </div>
      </AdminFieldGrid>
      <AdminFieldGrid columns={4}>
        <div>
          <Label htmlFor="instance-max-capacity">Max capacity</Label>
          <Input
            id="instance-max-capacity"
            value={value.maxCapacity}
            disabled={instanceFieldsLocked}
            onChange={(event) => {
              const nextMax = event.target.value;
              onChange({
                ...value,
                maxCapacity: nextMax,
                ...(nextMax.trim() === "" ? { capacityLeftOverride: "" } : {}),
              });
            }}
            type="number"
            min={0}
            placeholder="Unlimited if empty"
          />
        </div>
        <div>
          <Label htmlFor="instance-capacity-left-override">
            Capacity left override
          </Label>
          <Input
            id="instance-capacity-left-override"
            value={value.capacityLeftOverride}
            disabled={capacityOverrideDisabled}
            onChange={(event) =>
              onChange({ ...value, capacityLeftOverride: event.target.value })
            }
            type="number"
            min={0}
            autoComplete="off"
            placeholder="None"
          />
          {capacityOverrideDisabled && !instanceFieldsLocked ? (
            <p className="mt-1 text-xs text-slate-500">
              Set max capacity to enable a display-only spots-left override.
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="instance-waitlist">Waitlist</Label>
          <Select
            id="instance-waitlist"
            value={value.waitlistEnabled ? "true" : "false"}
            disabled={instanceFieldsLocked}
            onChange={(event) =>
              onChange({
                ...value,
                waitlistEnabled: event.target.value === "true",
              })
            }
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </Select>
        </div>
      </AdminFieldGrid>
    </div>
  );
}
