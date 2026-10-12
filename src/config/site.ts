// Everything a non-developer is likely to change lives here.

export const site = {
  name: 'Blueline PDF',
  tagline: 'Read, edit, sign and assemble PDFs on your own desktop.',
  supportEmail: 'support@example.com', // TODO: real support address
  company: 'Blueline PDF Software',
};

// Display copy for plans. Real prices are charged from the Stripe Price IDs configured in the Worker
// (STRIPE_PRICE_MONTHLY / _YEARLY / _LIFETIME). Keep these labels in step with those prices.
// TODO: replace the placeholder prices below with your launch prices.
export const plans = [
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$9',
    cadence: 'per month',
    blurb: 'Every feature, cancel any time.',
  },
  {
    id: 'yearly',
    name: 'Yearly',
    price: '$79',
    cadence: 'per year',
    blurb: 'Every feature, two months free compared with monthly.',
    featured: true,
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: '$199',
    cadence: 'one payment',
    blurb: 'Pay once and keep this major version for good.',
  },
] as const;

export type PlanId = (typeof plans)[number]['id'];

// TODO: confirm each line matches what ships in 1.0.
export const capabilities = [
  { verb: 'Edit', detail: 'Change text and images in place, keeping the original fonts and layout.' },
  { verb: 'Sign', detail: 'Add a drawn, typed or image signature and send a finished copy.' },
  { verb: 'Assemble', detail: 'Merge, split, reorder and rotate pages by dragging thumbnails.' },
  { verb: 'Mark up', detail: 'Highlight, comment and redact, then flatten for sharing.' },
  { verb: 'Fill', detail: 'Complete and save PDF forms, including ones without form fields.' },
  { verb: 'Convert', detail: 'Export to Word, images or plain text and back to PDF.' },
];

export const platformLabels: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};
