/**
 * Canonical `GET /v1/calendar/public`-shaped payload for public_www tests.
 * Covers: MBA training_course (alpha cohort), second MBA cohort, generic event, landing-page event.
 */
export const publicCalendarFixture = {
  status: 'success' as const,
  data: [
    {
      title: 'My Best Auntie Training Course 1-3 - Apr 26',
      description: 'Course cohort fixture for tests.',
      service_type: 'training_course',
      service_key: 'my-best-auntie-training-course',
      service_tier: '1-3',
      cohort: 'apr-26',
      spaces_total: 8,
      spaces_left: 4,
      is_fully_booked: false,
      price: 9000,
      currency: 'HKD',
      location: 'physical',
      booking_system: 'my-best-auntie-booking',
      tags: ['Helper', '1-3'],
      categories: ['Training Course'],
      dates: [
        {
          start_datetime: '2026-04-19T01:00:00Z',
          end_datetime: '2026-04-19T03:00:00Z',
          part: 1,
        },
        {
          start_datetime: '2026-05-10T01:00:00Z',
          end_datetime: '2026-05-10T03:00:00Z',
          part: 2,
        },
        {
          start_datetime: '2026-05-31T01:00:00Z',
          end_datetime: '2026-05-31T03:00:00Z',
          part: 3,
        },
      ],
      location_address: 'Unit 1, 1/F, Example Tower, 1 Sample Street, Hong Kong',
      location_url:
        'https://www.google.com/maps/dir/?api=1&destination=Example+Tower,+1+Sample+Street,+Hong+Kong',
      location_name: 'Evolve Sprouts',
      slug: 'my-best-auntie-1-3-apr-26',
    },
    {
      title: 'My Best Auntie Training Course 0-1 - May 26',
      description: 'Second MBA cohort for filter tests.',
      service_type: 'training_course',
      service_key: 'my-best-auntie-training-course',
      service_tier: '0-1',
      cohort: 'may-26',
      spaces_total: 8,
      spaces_left: 5,
      is_fully_booked: false,
      price: 9000,
      currency: 'HKD',
      location: 'physical',
      booking_system: 'my-best-auntie-booking',
      tags: ['Helper', '0-1'],
      categories: ['Training Course'],
      dates: [
        {
          start_datetime: '2026-05-17T01:00:00Z',
          end_datetime: '2026-05-17T03:00:00Z',
          part: 1,
        },
        {
          start_datetime: '2026-06-07T01:00:00Z',
          end_datetime: '2026-06-07T03:00:00Z',
          part: 2,
        },
        {
          start_datetime: '2026-06-28T01:00:00Z',
          end_datetime: '2026-06-28T03:00:00Z',
          part: 3,
        },
      ],
      location_address: 'Unit 1, 1/F, Example Tower, 1 Sample Street, Hong Kong',
      location_url:
        'https://www.google.com/maps/dir/?api=1&destination=Example+Tower,+1+Sample+Street,+Hong+Kong',
      location_name: 'Evolve Sprouts',
      slug: 'my-best-auntie-0-1-may-26',
    },
    {
      title: 'Generic Public Event',
      description: 'No landing page, no cohort.',
      service_type: 'event',
      service_key: 'generic-events',
      tags: ['Community'],
      categories: ['Meetup'],
      location: 'virtual',
      dates: [
        {
          start_datetime: '2026-07-01T10:00:00Z',
          end_datetime: '2026-07-01T11:00:00Z',
          part: 1,
        },
      ],
      slug: 'generic-public-event-2026-07-01',
    },
    {
      title: 'Easter 2026 Montessori Play Coaching Workshop',
      description:
        'A practical Montessori-inspired play coaching workshop for children ages 1-4, with parent and child participation (helpers warmly welcome).',
      tags: ['1-4', 'Parent + Child', 'Helpers Welcome'],
      categories: ['Workshop'],
      partners: ['happy-baton', 'baumhaus'],
      location: 'physical',
      booking_system: 'event-booking',
      service_type: 'event',
      service_key: 'easter-workshops',
      dates: [
        {
          start_datetime: '2026-04-06T02:00:00Z',
          end_datetime: '2026-04-06T03:00:00Z',
          part: 1,
        },
      ],
      spaces_total: 6,
      spaces_left: 5,
      price: 350,
      currency: 'HKD',
      is_fully_booked: false,
      location_name: 'Baumhaus',
      location_address: "1/F, Example Tower, 1 Sample Street, Hong Kong",
      location_url:
        'https://www.google.com/maps/dir/?api=1&destination=Example+Hall,+1+Sample+Street,+Hong+Kong',
      slug: 'easter-2026-montessori-play-coaching-workshop',
    },
    {
      title: 'The Missing Piece',
      description:
        'A hands-on workshop for families with children aged 0–2: the right toys, simple play-space tweaks, and practical tools your helper can use right away. Hosted with Little HK at Acorn Playhouse.',
      tags: ['0-2', 'Parent + Child', 'Helpers Welcome'],
      categories: ['Workshop'],
      partners: ['little-hk'],
      location: 'physical',
      booking_system: 'event-booking',
      service_type: 'event',
      service_key: 'missing-piece-series',
      dates: [
        {
          start_datetime: '2026-05-16T01:00:00Z',
          end_datetime: '2026-05-16T02:00:00Z',
          part: 1,
        },
      ],
      spaces_total: 8,
      spaces_left: 8,
      price: 150,
      currency: 'HKD',
      is_fully_booked: false,
      location_name: 'Acorn Playhouse',
      location_address: '1/F, 1 Sample Street, Hong Kong',
      location_url:
        'https://www.google.com/maps/dir/?api=1&destination=1%2FF%2C+1+Sample+Street%2C+Hong+Kong',
      slug: 'may-2026-the-missing-piece',
    },
  ],
};
