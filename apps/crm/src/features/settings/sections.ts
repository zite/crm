import type { Capability } from '@project/shared/roles';

/**
 * Every settings section, in the order the nav shows them. Adding one is a row
 * here plus a case in SettingsPage's switch — the nav, the mobile select, the
 * document title and the route all read from this list.
 */

export type SettingsSection = {
  slug: string;
  label: string;
  group: 'You' | 'Organization' | 'Data';
  /** Hidden from the nav, and refused by the page, without this capability. */
  capability?: Capability;
  blurb: string;
};

export const SECTIONS: SettingsSection[] = [
  { slug: 'profile', label: 'Profile', group: 'You', blurb: 'Your name, how you sign emails, and what you want to hear about.' },
  { slug: 'general', label: 'General', group: 'Organization', capability: 'settings.manage', blurb: 'What your organization is called, how it looks to buyers, and the money and calendar it keeps.' },
  { slug: 'members', label: 'Teammates', group: 'Organization', capability: 'members.manage', blurb: 'Who is on the team and what each of them can do.' },
  { slug: 'teams', label: 'Teams', group: 'Organization', capability: 'members.manage', blurb: 'Group your teammates so reports and quotas can roll up.' },
  { slug: 'pipelines', label: 'Pipelines', group: 'Organization', capability: 'settings.manage', blurb: 'The stages a deal moves through, and how long it may sit in each.' },
  { slug: 'products', label: 'Products', group: 'Organization', blurb: 'What your team sells, what it costs and how it bills.' },
  { slug: 'fields', label: 'Properties', group: 'Organization', capability: 'settings.manage', blurb: 'The fields your team added to companies, contacts, deals and leads.' },
  { slug: 'lists', label: 'Lists & tags', group: 'Organization', capability: 'settings.manage', blurb: 'The words your team picks from, and the tags it files things under.' },
  { slug: 'routing', label: 'Lead routing', group: 'Organization', capability: 'settings.manage', blurb: 'Who a new lead belongs to the moment it arrives.' },
  { slug: 'automations', label: 'Automations', group: 'Organization', capability: 'settings.manage', blurb: 'Rules that do the obvious thing so nobody has to remember to.' },
  { slug: 'import', label: 'Import', group: 'Data', capability: 'data.import', blurb: 'Bring companies, contacts, deals or leads in from a spreadsheet.' },
  { slug: 'export', label: 'Export', group: 'Data', capability: 'data.export', blurb: 'Take any list out as a CSV, complete rather than capped at what is on screen.' },
  { slug: 'data', label: 'Demo data', group: 'Data', capability: 'settings.manage', blurb: 'Clear the example organization out once your own work has started.' },
];

export const GROUPS: Array<SettingsSection['group']> = ['You', 'Organization', 'Data'];

export const sectionFor = (slug: string | undefined) => SECTIONS.find(s => s.slug === slug) ?? null;
