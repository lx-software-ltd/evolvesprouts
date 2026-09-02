import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EntityServicesSection } from '@/components/admin/contacts/entity-services-section';

describe('EntityServicesSection', () => {
  it('renders nothing when labels are empty', () => {
    const { container } = render(<EntityServicesSection id='crm-test-services' labels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a collapsed Services disclosure with the label count and one list item per label', async () => {
    const user = userEvent.setup();
    render(
      <EntityServicesSection
        id='crm-test-services'
        labels={['Event: June Weekend', 'Training course: Course A']}
      />
    );

    const trigger = screen.getByRole('button', { name: /^Services/ });
    expect(trigger).toHaveTextContent('2');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Event: June Weekend')).toBeInTheDocument();
    expect(screen.getByText('Training course: Course A')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
