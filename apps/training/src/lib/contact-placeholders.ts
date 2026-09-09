export const FORM_CONTACT_PLACEHOLDER_FALLBACKS: Record<string, string> = {
  contactName: 'there',
  contactFirstName: 'there',
  contactLastName: '',
  familyName: 'your family',
  'children.firstName': 'your child',
  'children.lastName': 'your child',
  'children.contactName': 'your child',
  'helpers.firstName': 'your helper',
  'helpers.lastName': 'your helper',
  'helpers.contactName': 'your helper',
};

const TOKEN_PATTERN = /\{([a-zA-Z]+(?:\.[a-zA-Z]+)?)\}/g;

export function applyContactPlaceholderTemplate(
  template: string,
  placeholders: Record<string, string>,
): string {
  return template.replace(TOKEN_PATTERN, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(placeholders, key)) {
      return placeholders[key] ?? '';
    }
    if (Object.prototype.hasOwnProperty.call(FORM_CONTACT_PLACEHOLDER_FALLBACKS, key)) {
      return FORM_CONTACT_PLACEHOLDER_FALLBACKS[key] ?? '';
    }
    return match;
  });
}

export function mergeFormContactPlaceholders(
  incoming: Record<string, string> | null | undefined,
): Record<string, string> {
  return {
    ...FORM_CONTACT_PLACEHOLDER_FALLBACKS,
    ...(incoming ?? {}),
  };
}
