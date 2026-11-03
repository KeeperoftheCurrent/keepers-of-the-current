# The Current: mobile journey design

Maroon cloth, antique gold, black details. The authentic infinity-vine sigil and sign-inspired wordmark identify the faith. Original reference photographs stay outside public assets; finished AI artwork is labelled as illustration.

## Page hierarchy
- Home: welcome, three entrances (faith, trials, Keepers Rest), three paths, film, first steps.
- The Current: short introduction, chapter links, Keeper portrait, films, complete optional lore.
- Trials: nine stable deep links, preparation/checklist first, complete original rules available.
- Keepers Rest: outreach welcome, member benefits, explicit visitor kitchen arrangements and members-only rest/storage.
- Register: gathering → multiple trials and times → identity → review and confirmation.
- My Trials: identity → next appointment/preparation → chronological itinerary → earned progress → gatherings/history.

## Components and language
`journeys.css` is the final editorial layer after legacy theme, reading and artwork styles. Reading preferences remain authoritative. Serif display headings; system sans-serif body; ornamental lettering only in the brand. No new animation or autoplay. Actions are literal and concise; surrounding language is in character.

Confirmed appointment means reserved time. Planned/requested means no reserved time. Completed progress is recorded by the Keeper. Never imply that Discord Interested reserves a website appointment.

Phone cards use one column; targets at least 44px; date/time and preparation are adjacent. Screenshot copies can become stale; the authenticated Scroll remains the current source. Never cache private progress for offline use.

## Release verification
30 regression tests plus TypeScript. Compare full original lore/rules/art SVGs with the previous revision. Check all eight public pages at 320px with larger text/light background; inspect 390px and desktop visually. Shared email changes require both Pages and reminder worker release. Do not trigger a real reminder batch for verification.
