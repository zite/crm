import { Tabs } from '../../ui/Tabs';

/**
 * The four surfaces under Outreach. Sequences and Templates are built here;
 * Forms and Meeting links are their own areas, and the row links to their
 * routes so the section reads as one place whichever one you are on.
 *
 * No counts. Only two of the four could ever carry one from here, and a page
 * that showed them next to two that couldn't made the row change shape as you
 * moved between tabs. Each page states its own count in its toolbar instead.
 */
export function OutreachTabs() {
  return (
    <Tabs
      items={[
        { value: 'sequences', label: 'Sequences', to: '/outreach/sequences' },
        { value: 'templates', label: 'Templates', to: '/outreach/templates' },
        { value: 'forms', label: 'Forms', to: '/outreach/forms' },
        { value: 'meetings', label: 'Meeting links', to: '/outreach/meetings' },
      ]}
    />
  );
}
