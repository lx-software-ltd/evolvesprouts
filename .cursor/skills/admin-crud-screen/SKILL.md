---
name: admin-crud-screen
description: Build or change an admin list, filter bar, expandable editor, or row action using the shared table-first primitives.
paths: apps/admin_web/**
---

# Admin CRUD screen

Use the primitives in `src/components/ui/`. Do not reintroduce `AdminEditorCard`, `PaginatedTableCard`, `AdminTableToolbar`, or `AdminCollapsibleSection`.

## Page

Filters, then the table, inside one untitled card from `AdminRecordTable`. No listing title or description.

`AdminFilterBar` labels sit above the controls. `AdminCreateButton` is in the trailing slot, spells its noun (`New contact`), uses `sm:h-9`, and moves to its own full-width line on phones. No `+` icon.

Controls keep the shared white background. Selects and dates apply immediately. Free text is debounced through `usePaginatedList`. No Apply and no Clear button. Keep filters to one desktop line.

A one-click tool is a `Button` in the trailing slot. Multi-field tools such as imports are an `AdminDisclosure` between the filters and the table, collapsed by default.

## Table

Use `AdminDataTable`. No `min-w-*` and no raw `<td>`.

Non-essential columns are `priority="secondary"` (from `md`) or `priority="tertiary"` (from `lg`) on both the head and the cell. Surface the most useful hidden value with `AdminDataTableCellMeta`.

Do not set `whitespace-nowrap` on a primary cell. Meta lines use `wrap-anywhere`. Long text uses `wrap-anywhere` and `line-clamp-*`. Separate adjacent fragments with a real space.

`AdminDataTableOperationsHeadCell` keeps its label `sr-only` below `md`. Omit the Operations column when a row has no actions.

Nested tables such as notes and members use `AdminRecordTable embedded` and must fit at 390px without horizontal scrolling.

## Rows

`useExpandedRecord` opens one row, syncs the id to the query string, and prompts before discarding unsaved edits.

The open record is framed by the `.admin-row-framed` and `.admin-row-detail-framed` inset shadows. Do not add `border-x-*` on the row.

Create inserts `DRAFT_RECORD_ID` at the top with the editor open. Nested lists use their own draft id (`note-draft`, `grant-draft`).

Duplicate opens that draft via `useDuplicateDraftTemplate`. Do not save a copy from the Operations column.

Read-only records still expand in place. `AdminDialog` is for viewers. `ConfirmDialog` is for confirm or cancel and may render extra fields such as a void reason.

Destructive row actions stay in Operations, not the editor footer.

Fetch a full record only when its row is open. Show `AdminEditorSkeleton` until it arrives. Show `AdminSkeletonRows` while the list loads.

Disclosures that need their own request mount their content only once opened.

## Editor

`AdminEditorPanel` has no title. One `AdminEditorActions` row, `justify-start`, with a single primary `Create` or `Update` button. No Cancel button. Collapse the row to leave. When the fields are a form, set a stable `id` and point the button at it with `form`.

`AdminFieldGrid` columns are 1, 2, or 4. Use `span` for a wider control. Read-only values are `readOnly` inputs so every field has the same shape.

Sub-sections use `AdminDisclosure`. Do not repeat the disclosure title as an inner label.

A phone region plus national number may be two controls in one `AdminField`. Comment any other exception at the site.

Asset file replacement lives in the editor, not Operations.

Any button that starts a request uses `Button` with `loading`. The default loading copy is `Saving…`. Pass `loadingLabel` for other actions.

## Operations

`AdminRowActions` renders icon-only controls of equal size, with a border, a white background, and a tooltip. More than two actions: the first stays inline and the rest go in the overflow menu. Destructive actions use the `danger` tone and still confirm.

## Done

`npm run lint` and `npx vitest run` in `apps/admin_web` pass, including a test that covers the changed empty, error, or mobile state when the screen already has tests.
