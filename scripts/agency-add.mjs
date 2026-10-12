#!/usr/bin/env node
// Add an agency, its contact, a matching Stripe customer, and (optionally) a free pilot license.
//
//   npm run agency:add -- --name "Fulton Police Department" --email records@fulton.gov \
//        [--ori MO0140100] [--pilot-days 90 --plan standard --seats 5] [--no-stripe]
//
// Reads keys from .dev.vars. Use the Stripe customer it prints when you invoice the agency later;
// its metadata links payments back to this agency automatically.
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const { values: a } = parseArgs({
  options: {
    name: { type: 'string' },
    email: { type: 'string', multiple: true },
    ori: { type: 'string' },
    'pilot-days': { type: 'string' },
    plan: { type: 'string', default: 'standard' },
    seats: { type: 'string', default: '5' },
    'no-stripe': { type: 'boolean', default: false },
  },
});

const fail = (m) => {
  console.error(m);
  process.exit(1);
};
if (!a.name || !a.email?.length) fail('Required: --name "Agency name" --email contact@agency.gov (repeat --email for more contacts)');
if (!['standard', 'bundle', 'pro'].includes(a.plan)) fail('--plan must be standard, bundle or pro');
const seats = a.plan === 'bundle' ? 10 : Number(a.seats);
if (!Number.isInteger(seats) || seats < 1) fail('--seats must be a whole number');
const pilotDays = a['pilot-days'] ? Number(a['pilot-days']) : 0;
if (a['pilot-days'] && (!Number.isInteger(pilotDays) || pilotDays < 1 || pilotDays > 365)) fail('--pilot-days must be 1–365');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .dev.vars');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const emails = a.email.map((e) => e.trim().toLowerCase());
const ori = a.ori?.trim().toUpperCase() || null;

const agency = await db.from('agencies').insert({ name: a.name.trim(), ori }).select('id').single();
if (agency.error) fail(agency.error.message);
const agencyId = agency.data.id;

const members = await db.from('agency_members').insert(emails.map((email) => ({ agency_id: agencyId, email, role: 'admin' })));
if (members.error) fail(members.error.message);

let customerId = null;
if (!a['no-stripe']) {
  if (!STRIPE_SECRET_KEY) fail('Set STRIPE_SECRET_KEY in .dev.vars, or pass --no-stripe');
  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const customer = await stripe.customers.create({
    name: a.name.trim(),
    email: emails[0],
    metadata: { agency_id: agencyId, ...(ori ? { ori } : {}) },
  });
  customerId = customer.id;
  const upd = await db.from('agencies').update({ stripe_customer_id: customerId }).eq('id', agencyId);
  if (upd.error) fail(upd.error.message);
}

let key = null;
if (pilotDays) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => alphabet[b % alphabet.length]).join('');
  key = `BL-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
  const expires = new Date(Date.now() + pilotDays * 86400000).toISOString();
  const lic = await db.from('licenses').insert({ agency_id: agencyId, license_key: key, plan: a.plan, kind: 'pilot', seats, status: 'active', expires_at: expires });
  if (lic.error) fail(lic.error.message);
}

console.log(`\nAgency added: ${a.name}  (${agencyId})`);
console.log(`Contacts who can sign in: ${emails.join(', ')}`);
if (customerId) console.log(`Stripe customer: ${customerId}  — invoice this customer when they buy`);
if (key) console.log(`Pilot license: ${key}  (${a.plan}, ${seats} seats, ${pilotDays} days)`);
console.log('');
