import { zite } from 'zitejs/db';
import { chunked, num, str } from '@project/shared/server/sql';
import type { FormFieldDef } from '@project/shared/server/leads';
import { int, pick, pastIso } from './rng';
import { memberMap, type SeedPhase } from './core';

/**
 * Demo data for the leads area: the two web forms Ashgrove runs, and six weeks
 * of submissions wired to the leads the core seed already created, so the forms
 * list, the submissions tab and the conversion figures all have something true
 * to say. Idempotent and generated from the fixed seed — never Math.random().
 */

const field = (id: string, key: string, type: FormFieldDef['type'], label: string, required: boolean, extra: Partial<FormFieldDef> = {}): FormFieldDef => ({
  id,
  key,
  type,
  label,
  required,
  placeholder: extra.placeholder ?? null,
  help: extra.help ?? null,
  options: extra.options ?? [],
});

const DEMO_FIELDS: FormFieldDef[] = [
  field('fld_demo_name', 'name', 'short_text', 'Your name', true),
  field('fld_demo_email', 'email', 'email', 'Work email', true, { help: 'We’ll send the invite here.' }),
  field('fld_demo_company', 'companyName', 'short_text', 'Company', true),
  field('fld_demo_size', 'employees', 'number', 'How many people work there?', false, { placeholder: '250' }),
  field('fld_demo_when', 'timeline', 'select', 'When are you hoping to be live?', false, { options: ['This quarter', 'Next quarter', 'Later this year', 'Just looking'] }),
  field('fld_demo_message', 'message', 'long_text', 'What would you like to see?', false, { placeholder: 'The bits of your process you want to fix.' }),
];

const SALES_FIELDS: FormFieldDef[] = [
  field('fld_sales_name', 'name', 'short_text', 'Your name', true),
  field('fld_sales_email', 'email', 'email', 'Work email', true),
  field('fld_sales_company', 'companyName', 'short_text', 'Company', true),
  field('fld_sales_phone', 'phone', 'phone', 'Phone', false, { help: 'Only if you’d rather we called.' }),
  field('fld_sales_topic', 'topic', 'select', 'What’s this about?', true, { options: ['Pricing', 'Security review', 'Migrating from another system', 'Partnerships', 'Something else'] }),
  field('fld_sales_message', 'message', 'long_text', 'Tell us a little more', false),
  field('fld_sales_consent', 'consent', 'checkbox', 'Send me the occasional product update', false),
];

const TIMELINES = ['This quarter', 'Next quarter', 'Later this year', 'Just looking'];
const TOPICS = ['Pricing', 'Security review', 'Migrating from another system', 'Partnerships', 'Something else'];

export const seedForms: SeedPhase = {
  key: 'forms',
  label: 'web forms',
  run: async ({ actor }) => {
    const existing = await zite.forms.findAll({ limit: 1 });
    if (existing.records.length) return;
    const members = await memberMap();
    const marcus = members.get('marcus') ?? actor.id;
    const aisha = members.get('aisha') ?? actor.id;
    const maya = members.get('maya') ?? actor.id;

    await zite.forms.bulkCreate({
      records: [
        {
          name: 'Request a demo',
          slug: 'request-a-demo',
          intro: 'Tell us a little about your operation and we’ll set up a walkthrough with someone who knows it well. Half an hour, no slides.',
          fields: JSON.stringify(DEMO_FIELDS),
          status: 'Live',
          submitLabel: 'Request a demo',
          successMessage: 'Thanks — we’ve got it. Someone from the team will email you within a business day to find a time.',
          assignment: 'Round Robin',
          source: 'Demo request',
          notifyIds: JSON.stringify([...new Set([marcus, aisha])]),
          ownerId: marcus,
          submissionCount: 0,
        },
        {
          name: 'Contact sales',
          slug: 'contact-sales',
          intro: 'Pricing, a security review, or moving off something else — send it over and we’ll come back with a straight answer.',
          fields: JSON.stringify(SALES_FIELDS),
          status: 'Live',
          submitLabel: 'Send message',
          successMessage: 'Thanks — your message is with the team. You’ll hear back within a business day.',
          assignment: 'Member',
          assigneeId: maya,
          source: 'Website form',
          notifyIds: JSON.stringify([maya]),
          ownerId: maya,
          submissionCount: 0,
        },
      ],
    });
  },
};

export const seedSubmissions: SeedPhase = {
  key: 'submissions',
  label: 'form submissions',
  run: async ({ today, rng }) => {
    const existing = await zite.submissions.findAll({ limit: 1 });
    if (existing.records.length) return;
    const { rows: forms } = await zite.sql({ query: `SELECT id, "slug", "name", "source" FROM "Forms" ORDER BY created_at LIMIT 5`, params: [] });
    const demo = forms.find(f => f.slug === 'request-a-demo');
    const sales = forms.find(f => f.slug === 'contact-sales');
    if (!demo || !sales) return;

    // The leads the core seed made from the website are the ones these forms produced.
    const { rows: leads } = await zite.sql({
      query: `SELECT id, "name", "email", "companyName", "employees", "phone", "message", "source", "receivedAt", created_at
        FROM "Leads" WHERE "source" IN ('Demo request', 'Website form', 'Content download')
        ORDER BY COALESCE("receivedAt", created_at) DESC LIMIT 16`,
      params: [],
    });
    const { rows: contacts } = await zite.sql({
      query: `SELECT c.id, c."name", c."email" FROM "Contacts" c WHERE COALESCE(c."email", '') <> '' ORDER BY c."lastActivityAt" DESC NULLS LAST LIMIT 4`,
      params: [],
    });

    const submissions: Array<Record<string, unknown>> = [];
    const leadForm = new Map<string, string>();
    const counts = new Map<string, { total: number; last: string }>();
    const bump = (formId: string, at: string) => {
      const current = counts.get(formId);
      counts.set(formId, { total: (current?.total ?? 0) + 1, last: !current || at > current.last ? at : current.last });
    };

    leads.forEach((lead, index) => {
      const form = String(lead.source) === 'Demo request' || index % 3 === 0 ? demo : sales;
      const formId = String(form.id);
      const at = str(lead.receivedAt) ?? new Date(String(lead.created_at)).toISOString();
      const answers: Record<string, unknown> = {
        name: str(lead.name),
        email: str(lead.email),
        companyName: str(lead.companyName),
      };
      if (formId === String(demo.id)) {
        if (lead.employees != null) answers.employees = num(lead.employees);
        answers.timeline = pick(rng, TIMELINES);
      } else {
        if (str(lead.phone)) answers.phone = str(lead.phone);
        answers.topic = pick(rng, TOPICS);
        answers.consent = index % 2 === 0;
      }
      if (str(lead.message)) answers.message = str(lead.message);
      submissions.push({
        formId,
        email: str(lead.email),
        name: str(lead.name),
        answers: JSON.stringify(answers),
        leadId: String(lead.id),
        outcome: 'New Lead',
        submittedAt: at,
        pageUrl: formId === String(demo.id) ? 'https://www.ashgrovesoftware.example/demo' : 'https://www.ashgrovesoftware.example/contact',
        referrer: index % 4 === 0 ? 'https://www.google.com/' : index % 4 === 1 ? 'https://www.linkedin.com/' : null,
        utm: index % 4 <= 1 ? JSON.stringify({ source: index % 4 === 0 ? 'google' : 'linkedin', medium: 'cpc', campaign: 'warehouse-ops' }) : null,
      });
      leadForm.set(String(lead.id), formId);
      bump(formId, at);
    });

    // People we already know coming back through the form — the reason the
    // submissions tab shows outcomes at all.
    contacts.forEach((contact, index) => {
      const form = index % 2 === 0 ? sales : demo;
      const formId = String(form.id);
      const at = pastIso(rng, today, int(rng, 2, 40));
      submissions.push({
        formId,
        email: str(contact.email),
        name: str(contact.name),
        answers: JSON.stringify({
          name: str(contact.name),
          email: str(contact.email),
          companyName: null,
          ...(formId === String(sales.id) ? { topic: pick(rng, TOPICS) } : { timeline: pick(rng, TIMELINES) }),
          message: pick(rng, [
            'Can you send the latest security questionnaire? Our IT team asked for it.',
            'We added two more sites — what does that do to the price?',
            'Could we get a second walkthrough for the operations team?',
          ]),
        }),
        contactId: String(contact.id),
        outcome: 'Existing Contact',
        submittedAt: at,
        pageUrl: 'https://www.ashgrovesoftware.example/contact',
      });
      bump(formId, at);
    });

    // One obvious robot, so the spam filter isn't a claim nobody can see.
    const spamAt = pastIso(rng, today, int(rng, 5, 30));
    submissions.push({ formId: String(sales.id), email: 'seo-outreach@link-building.example', name: null, answers: null, outcome: 'Spam', submittedAt: spamAt, pageUrl: 'https://www.ashgrovesoftware.example/contact' });
    bump(String(sales.id), spamAt);

    await chunked(submissions, async batch => void (await zite.submissions.bulkCreate({ records: batch })));

    for (const [leadId, formId] of leadForm) {
      await zite.leads.update({ id: leadId, record: { formId } });
    }
    for (const [formId, stat] of counts) {
      await zite.forms.update({ id: formId, record: { submissionCount: stat.total, lastSubmissionAt: stat.last } });
    }
  },
};

/** Demo data for the leads area. Owned by that area — see BRIEF.md. */
export const LEADS_PHASES: SeedPhase[] = [seedForms, seedSubmissions];
