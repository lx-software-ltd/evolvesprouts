---
name: public-www-section
description: Add or rename a public website section so content keys, components, files, and locales stay aligned.
paths: apps/public_www/**
---

# Public website section

1. Add the copy to `src/content/en.json` using lowerCamelCase key segments, then mirror the same keys in `zh-CN.json` and `zh-HK.json`. `_comment`-style meta keys and kebab-case slugs are allowed. `family-consultations.json` stays snake_case.
2. Name the component from the content path in PascalCase (`aboutUs.whyUs` becomes `AboutUsWhyUs`).
3. Name the file from that component in kebab-case and place it under `src/components/sections/**` (`about-us-why-us.tsx`).
4. Set `SectionShell` `id` and `dataFigmaNode` to that kebab-case file key. Keep an existing navigation anchor when product links already use it, and set both attributes to that anchor.
5. Put page composition in `src/components/pages/**` and shared primitives in `src/components/shared/**`.
6. Put the test under `apps/public_www/tests/**`, mirroring the source area.
7. Do not hardcode user-visible English, inline SVG, or `dangerouslySetInnerHTML`.

`family-consultations.json` is the exception to camelCase: keys stay snake_case, and location fields use `location_name`, `location_address`, and `location_url`.

## Done

`npm run validate:content` and `npm run lint` in `apps/public_www` pass.
