// Copy and prices that change without touching layout. Prices here are display only:
// what agencies are charged is whatever you put on the Stripe invoice.

export const site = {
  name: 'Blueline',
  company: 'Blueline PDF Software',
  title: 'Blueline – PDF & Records Software for Police Agencies',
  description: 'Offline-first PDF redaction, forms, and records software built for police agencies.',
  contactEmail: 'support@example.com', // TODO: real address
  announcement: {
    lead: 'Founding Agency Offer:',
    text: '40% off your first year when you join our pilot program.',
  },
};


export const plans = [
  {
    id: 'officer',
    name: 'Officer Edition',
    for: 'For individual officers',
    price: '$0',
    unit: 'forever',
    features: ['View & annotate', 'Fill & sign forms', 'Merge & print', 'OCR'],
    cta: { label: 'Download free', href: '/api/download', style: 'ghost' },
  },
  {
    id: 'standard',
    name: 'Agency Standard',
    for: 'For departments that need redaction',
    price: '$129',
    unit: '/ seat / year',
    featured: true,
    features: [
      'Everything in Officer',
      'Redaction with exemption codes & logs',
      'Verification & hidden-data removal',
      'Batch redaction, PDF/A',
      'Certificate signing & audit trail',
      'Email support',
    ],
    cta: { label: 'Request a quote', href: '/#contact', style: 'gold' },
  },
  {
    id: 'bundle',
    name: 'Small Agency Bundle',
    for: 'For departments with 10 or fewer users',
    price: '$990',
    unit: '/ year · up to 10 seats',
    features: ['Agency Standard for 10 seats', 'Locked agency settings', 'Remote onboarding session'],
    cta: { label: 'Request a quote', href: '/#contact', style: 'ghost' },
  },
  {
    id: 'pro',
    name: 'Records Pro',
    for: 'For records units & larger agencies',
    price: '$199',
    unit: '/ seat / year',
    features: [
      'Everything in Agency Standard',
      'Records request tracker & release packet',
      'Second-person review',
      'Redaction presets',
      'Custodian certification & retention labels',
      'Priority support',
    ],
    cta: { label: 'Request a quote', href: '/#contact', style: 'ghost' },
  },
] as const;

export const planNames: Record<string, string> = {
  standard: 'Agency Standard',
  bundle: 'Small Agency Bundle',
  pro: 'Records Pro',
};
