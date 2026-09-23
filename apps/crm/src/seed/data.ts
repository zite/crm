/**
 * Demo content for the sample organization: Ashgrove Software, which sells a
 * warehouse and fleet operations platform to mid-market operators. Every
 * company uses a reserved `.example` domain, so nothing here can send real
 * email or be mistaken for a real customer.
 */

export const ORG = {
  name: 'Ashgrove Software',
  domain: 'ashgrove.example',
  timezone: 'America/Los_Angeles',
  currency: 'USD',
  address: 'Ashgrove Software · 1200 SE Water Ave, Suite 240 · Portland, OR 97214',
  footer: 'You’re receiving this because you spoke with someone at Ashgrove Software.',
};

export type SeedMember = { key: string; name: string; email: string; role: 'Admin' | 'Manager' | 'Rep' | 'Viewer'; title: string; team: 'ae' | 'sdr' | 'none'; phone: string };

export const MEMBERS: SeedMember[] = [
  { key: 'maya', name: 'Maya Brooks', email: 'maya.brooks@ashgrove.example', role: 'Manager', title: 'VP of Sales', team: 'ae', phone: '(503) 555-0142' },
  { key: 'daniel', name: 'Daniel Okafor', email: 'daniel.okafor@ashgrove.example', role: 'Rep', title: 'Senior Account Executive', team: 'ae', phone: '(503) 555-0178' },
  { key: 'sofia', name: 'Sofía Marín', email: 'sofia.marin@ashgrove.example', role: 'Rep', title: 'Account Executive', team: 'ae', phone: '(503) 555-0119' },
  { key: 'hannah', name: 'Hannah Lindqvist', email: 'hannah.lindqvist@ashgrove.example', role: 'Rep', title: 'Account Executive', team: 'ae', phone: '(503) 555-0160' },
  { key: 'marcus', name: 'Marcus Bell', email: 'marcus.bell@ashgrove.example', role: 'Rep', title: 'Sales Development Rep', team: 'sdr', phone: '(503) 555-0133' },
  { key: 'aisha', name: 'Aisha Karim', email: 'aisha.karim@ashgrove.example', role: 'Rep', title: 'Sales Development Rep', team: 'sdr', phone: '(503) 555-0127' },
  { key: 'grace', name: 'Grace Chen', email: 'grace.chen@ashgrove.example', role: 'Viewer', title: 'Finance Analyst', team: 'none', phone: '(503) 555-0191' },
];

export const TEAMS = [
  { key: 'ae', name: 'Account Executives', description: 'Runs every deal from qualification to signature.', lead: 'maya' },
  { key: 'sdr', name: 'Sales Development', description: 'Works inbound leads and books first meetings.', lead: 'marcus' },
];

export const PIPELINES = [
  {
    key: 'new',
    name: 'New business',
    description: 'First-time customers, from qualification to signature.',
    isDefault: true,
    stages: [
      { name: 'Qualification', probability: 10, rottingDays: 10, kind: 'Open' as const, guidance: 'Confirm the operations problem, the timeline and who signs.' },
      { name: 'Discovery', probability: 25, rottingDays: 14, kind: 'Open' as const, guidance: 'Map the current workflow, volumes and systems it has to sit beside.' },
      { name: 'Demo', probability: 40, rottingDays: 14, kind: 'Open' as const, guidance: 'Show the flows that matter to them, with their own numbers.' },
      { name: 'Proposal', probability: 60, rottingDays: 21, kind: 'Open' as const, guidance: 'Quote sent, scope agreed, security review under way.' },
      { name: 'Negotiation', probability: 80, rottingDays: 14, kind: 'Open' as const, guidance: 'Terms, procurement and the start date.' },
      { name: 'Closed won', probability: 100, rottingDays: null, kind: 'Won' as const, guidance: '' },
      { name: 'Closed lost', probability: 0, rottingDays: null, kind: 'Lost' as const, guidance: '' },
    ],
  },
  {
    key: 'renewal',
    name: 'Renewals & expansion',
    description: 'Existing customers: renewals, added sites and upgrades.',
    isDefault: false,
    stages: [
      { name: 'Upcoming', probability: 50, rottingDays: 30, kind: 'Open' as const, guidance: 'Ninety days out: confirm usage, champion and budget owner.' },
      { name: 'In review', probability: 70, rottingDays: 21, kind: 'Open' as const, guidance: 'Renewal terms under discussion.' },
      { name: 'Committed', probability: 90, rottingDays: 14, kind: 'Open' as const, guidance: 'Verbal agreement; paperwork out.' },
      { name: 'Renewed', probability: 100, rottingDays: null, kind: 'Won' as const, guidance: '' },
      { name: 'Churned', probability: 0, rottingDays: null, kind: 'Lost' as const, guidance: '' },
    ],
  },
];

export const INDUSTRIES = ['Logistics', 'Manufacturing', 'Retail', 'Food & Beverage', 'Construction', 'Healthcare', 'Energy', 'Wholesale', 'Transportation', 'Agriculture'];
export const LEAD_SOURCES = ['Website form', 'Demo request', 'Referral', 'Outbound', 'Event', 'Webinar', 'Partner', 'Content download'];
export const LOST_REASONS = ['Price', 'Chose a competitor', 'No budget', 'No decision', 'Timing', 'Missing capability', 'Built in-house'];
export const DISQUALIFY_REASONS = ['Too small', 'Not a fit', 'Student or researcher', 'Competitor', 'Duplicate', 'Bad contact details', 'Spam'];

export const TAGS = [
  { name: 'Enterprise', color: 'navy', description: '1,000+ employees' },
  { name: 'Multi-site', color: 'teal', description: 'More than three warehouses' },
  { name: 'Champion found', color: 'moss', description: 'Someone inside is selling for us' },
  { name: 'Security review', color: 'ochre', description: 'Needs SOC 2 and a questionnaire' },
  { name: 'Competitive', color: 'rose', description: 'Evaluating another vendor' },
  { name: 'Referenceable', color: 'plum', description: 'Happy to talk to prospects' },
];

export type SeedCompany = {
  name: string;
  domain: string;
  industry: string;
  employees: number;
  revenue: number;
  city: string;
  region: string;
  type: 'Prospect' | 'Customer' | 'Partner' | 'Former Customer';
  description: string;
  owner: string;
  contacts: Array<{ first: string; last: string; title: string }>;
};

export const COMPANIES: SeedCompany[] = [
  { name: 'Harbor Freight Collective', domain: 'harborfreight.example', industry: 'Logistics', employees: 1400, revenue: 320_000_000, city: 'Long Beach', region: 'CA', type: 'Customer', description: 'Third-party logistics operator running eleven cross-dock facilities on the west coast.', owner: 'daniel', contacts: [{ first: 'Priya', last: 'Raman', title: 'VP Operations' }, { first: 'Errol', last: 'Whitaker', title: 'Director of Warehousing' }, { first: 'June', last: 'Castellanos', title: 'IT Manager' }] },
  { name: 'Northbeam Manufacturing', domain: 'northbeam.example', industry: 'Manufacturing', employees: 860, revenue: 210_000_000, city: 'Akron', region: 'OH', type: 'Customer', description: 'Steel fabrication for commercial construction, four plants across the midwest.', owner: 'sofia', contacts: [{ first: 'Thomas', last: 'Feld', title: 'COO' }, { first: 'Alice', last: 'Nwosu', title: 'Plant Manager' }] },
  { name: 'Cedarline Grocers', domain: 'cedarline.example', industry: 'Retail', employees: 3200, revenue: 890_000_000, city: 'Minneapolis', region: 'MN', type: 'Prospect', description: 'Regional grocery chain with 78 stores and two distribution centres.', owner: 'daniel', contacts: [{ first: 'Marguerite', last: 'Okonkwo-Baptiste', title: 'SVP Supply Chain' }, { first: 'Devon', last: 'Hale', title: 'Distribution Centre Lead' }, { first: 'Sana', last: 'Qureshi', title: 'Procurement Manager' }] },
  { name: 'Ridgeway Foods', domain: 'ridgewayfoods.example', industry: 'Food & Beverage', employees: 540, revenue: 96_000_000, city: 'Boise', region: 'ID', type: 'Prospect', description: 'Cold-chain producer of prepared meals for regional grocers.', owner: 'hannah', contacts: [{ first: 'Lena', last: 'Prescott', title: 'Head of Operations' }, { first: 'Bo', last: 'Tran', title: 'Warehouse Supervisor' }] },
  { name: 'Quarry & Sons Construction', domain: 'quarryandsons.example', industry: 'Construction', employees: 420, revenue: 145_000_000, city: 'Denver', region: 'CO', type: 'Prospect', description: 'Heavy civil contractor with a large equipment yard and rolling fleet.', owner: 'sofia', contacts: [{ first: 'Ray', last: 'Dunleavy', title: 'Equipment Director' }, { first: 'Constance', last: 'Ibarra', title: 'Finance Director' }] },
  { name: 'Meridian Health Supply', domain: 'meridianhs.example', industry: 'Healthcare', employees: 2100, revenue: 640_000_000, city: 'Nashville', region: 'TN', type: 'Prospect', description: 'Medical supply distributor serving 400 clinics in the southeast.', owner: 'daniel', contacts: [{ first: 'Dr. Amara', last: 'Keene', title: 'VP Clinical Logistics' }, { first: 'Stephen', last: 'Vo', title: 'Operations Analyst' }] },
  { name: 'Solstice Energy Partners', domain: 'solsticeenergy.example', industry: 'Energy', employees: 780, revenue: 410_000_000, city: 'Houston', region: 'TX', type: 'Prospect', description: 'Field services for solar and storage installations across five states.', owner: 'hannah', contacts: [{ first: 'Gabriela', last: 'Santos', title: 'Director of Field Operations' }, { first: 'Miles', last: 'Ferrand', title: 'Inventory Manager' }] },
  { name: 'Brightwater Beverage', domain: 'brightwaterbev.example', industry: 'Food & Beverage', employees: 260, revenue: 58_000_000, city: 'Asheville', region: 'NC', type: 'Customer', description: 'Craft beverage producer distributing through three regional warehouses.', owner: 'sofia', contacts: [{ first: 'Nadia', last: 'Kellerman', title: 'Operations Lead' }, { first: 'Chris', last: 'Boateng', title: 'Logistics Coordinator' }] },
  { name: 'Ironvale Wholesale', domain: 'ironvale.example', industry: 'Wholesale', employees: 640, revenue: 175_000_000, city: 'Kansas City', region: 'MO', type: 'Prospect', description: 'Industrial parts wholesaler with same-day delivery in twelve metros.', owner: 'daniel', contacts: [{ first: 'Walt', last: 'Perrone', title: 'General Manager' }, { first: 'Isabel', last: 'Ferreira', title: 'Systems Lead' }] },
  { name: 'Alder & Finch Retail Group', domain: 'alderfinch.example', industry: 'Retail', employees: 1750, revenue: 380_000_000, city: 'Providence', region: 'RI', type: 'Prospect', description: 'Home goods retailer, 54 stores plus a growing direct channel.', owner: 'hannah', contacts: [{ first: 'Colin', last: 'Marchetti', title: 'Director of Fulfilment' }, { first: 'Teresa', last: 'Ahn', title: 'Head of Store Operations' }] },
  { name: 'Pinnacle Transport Lines', domain: 'pinnacletransport.example', industry: 'Transportation', employees: 980, revenue: 265_000_000, city: 'Springfield', region: 'IL', type: 'Customer', description: 'Regional trucking company running 340 tractors and six terminals.', owner: 'sofia', contacts: [{ first: 'Dwayne', last: 'Kessler', title: 'VP Fleet' }, { first: 'Mina', last: 'Haddad', title: 'Terminal Manager' }] },
  { name: 'Verdant Farms Cooperative', domain: 'verdantfarms.example', industry: 'Agriculture', employees: 320, revenue: 74_000_000, city: 'Salinas', region: 'CA', type: 'Prospect', description: 'Grower cooperative packing and shipping produce for 40 member farms.', owner: 'hannah', contacts: [{ first: 'Rosa', last: 'Delgado', title: 'Packing House Manager' }, { first: 'Aaron', last: 'Whitcombe', title: 'Co-op Director' }] },
  { name: 'Kestrel Medical Devices', domain: 'kestrelmed.example', industry: 'Healthcare', employees: 1100, revenue: 295_000_000, city: 'Rochester', region: 'MN', type: 'Prospect', description: 'Manufacturer of surgical instruments with strict lot traceability rules.', owner: 'daniel', contacts: [{ first: 'Yusuf', last: 'Demir', title: 'Director of Quality' }, { first: 'Hannah', last: 'Oyelaran', title: 'Supply Chain Manager' }] },
  { name: 'Granite Peak Outfitters', domain: 'granitepeak.example', industry: 'Retail', employees: 190, revenue: 41_000_000, city: 'Bozeman', region: 'MT', type: 'Customer', description: 'Outdoor equipment retailer with one warehouse and heavy seasonal swings.', owner: 'sofia', contacts: [{ first: 'Jonah', last: 'Reyes', title: 'Operations Manager' }] },
  { name: 'Fairmount Industrial', domain: 'fairmountind.example', industry: 'Manufacturing', employees: 1450, revenue: 520_000_000, city: 'Pittsburgh', region: 'PA', type: 'Prospect', description: 'Precision components for rail and mining, three plants and a service depot.', owner: 'maya', contacts: [{ first: 'Barbara', last: 'Steinhauer', title: 'Chief Operating Officer' }, { first: 'Kwame', last: 'Adjei', title: 'Director of Planning' }] },
  { name: 'Lumen Pharmacy Services', domain: 'lumenrx.example', industry: 'Healthcare', employees: 460, revenue: 128_000_000, city: 'Tempe', region: 'AZ', type: 'Prospect', description: 'Central-fill pharmacy operator shipping to 220 independent pharmacies.', owner: 'hannah', contacts: [{ first: 'Elena', last: 'Rukavina', title: 'VP Operations' }, { first: 'Paul', last: 'Yamada', title: 'Compliance Lead' }] },
  { name: 'Copperline Electric', domain: 'copperline.example', industry: 'Construction', employees: 610, revenue: 168_000_000, city: 'Charlotte', region: 'NC', type: 'Prospect', description: 'Electrical contractor managing material across 60 active job sites.', owner: 'sofia', contacts: [{ first: 'Trent', last: 'Boucher', title: 'Director of Field Services' }, { first: 'Maria', last: 'Solano', title: 'Purchasing Lead' }] },
  { name: 'Silver Birch Logistics', domain: 'silverbirch.example', industry: 'Logistics', employees: 2400, revenue: 710_000_000, city: 'Columbus', region: 'OH', type: 'Prospect', description: 'Contract logistics provider running fulfilment for consumer brands.', owner: 'maya', contacts: [{ first: 'Adaeze', last: 'Obi', title: 'SVP Operations' }, { first: 'Rick', last: 'Lindgren', title: 'Director of Technology' }, { first: 'Petra', last: 'Novak', title: 'Continuous Improvement Lead' }] },
  { name: 'Marrow & Co. Butchery', domain: 'marrowco.example', industry: 'Food & Beverage', employees: 85, revenue: 18_000_000, city: 'Austin', region: 'TX', type: 'Former Customer', description: 'Specialty meat supplier to restaurants; outgrew their old system and left for a cheaper one.', owner: 'hannah', contacts: [{ first: 'Sam', last: 'Ortega', title: 'Owner' }] },
  { name: 'Tidewater Marine Supply', domain: 'tidewatermarine.example', industry: 'Wholesale', employees: 240, revenue: 62_000_000, city: 'Norfolk', region: 'VA', type: 'Prospect', description: 'Marine parts distributor with a busy counter and a growing web channel.', owner: 'daniel', contacts: [{ first: 'Gordon', last: 'Whitlock', title: 'General Manager' }] },
  { name: 'Aspen Ridge Hospitality', domain: 'aspenridge.example', industry: 'Retail', employees: 1300, revenue: 240_000_000, city: 'Salt Lake City', region: 'UT', type: 'Prospect', description: 'Hotel group managing central stores for 19 properties.', owner: 'hannah', contacts: [{ first: 'Violet', last: 'Anand', title: 'Director of Procurement' }] },
  { name: 'Foundry Row Brewing', domain: 'foundryrow.example', industry: 'Food & Beverage', employees: 130, revenue: 26_000_000, city: 'Milwaukee', region: 'WI', type: 'Customer', description: 'Brewery with self-distribution in three states.', owner: 'sofia', contacts: [{ first: 'Otto', last: 'Lindemann', title: 'Head of Production' }] },
  { name: 'Stonebridge Building Supply', domain: 'stonebridgebs.example', industry: 'Wholesale', employees: 820, revenue: 198_000_000, city: 'Raleigh', region: 'NC', type: 'Prospect', description: 'Building materials supplier with 14 branches and a delivery fleet.', owner: 'daniel', contacts: [{ first: 'Curtis', last: 'Mbeki', title: 'VP Distribution' }, { first: 'Delia', last: 'Fontaine', title: 'Branch Operations Manager' }] },
  { name: 'Halcyon Air Cargo', domain: 'halcyonair.example', industry: 'Transportation', employees: 560, revenue: 190_000_000, city: 'Memphis', region: 'TN', type: 'Prospect', description: 'Air freight forwarder with bonded warehouse operations.', owner: 'maya', contacts: [{ first: 'Ingrid', last: 'Sørensen', title: 'Director of Ground Operations' }] },
  { name: 'Whitefield Textiles', domain: 'whitefieldtex.example', industry: 'Manufacturing', employees: 380, revenue: 88_000_000, city: 'Greenville', region: 'SC', type: 'Prospect', description: 'Technical textiles manufacturer supplying automotive and medical customers.', owner: 'sofia', contacts: [{ first: 'Nora', last: 'Halloran', title: 'Operations Director' }] },
  { name: 'Juniper Grove Nurseries', domain: 'junipergrove.example', industry: 'Agriculture', employees: 210, revenue: 44_000_000, city: 'Eugene', region: 'OR', type: 'Customer', description: 'Wholesale plant nursery shipping to garden centres in eight states.', owner: 'hannah', contacts: [{ first: 'Beatrice', last: 'Kowalski', title: 'Operations Manager' }] },
  { name: 'Anchor Point Seafood', domain: 'anchorpointsea.example', industry: 'Food & Beverage', employees: 340, revenue: 79_000_000, city: 'Seattle', region: 'WA', type: 'Prospect', description: 'Seafood processor with tight cold-chain and traceability requirements.', owner: 'daniel', contacts: [{ first: 'Hae-won', last: 'Pak', title: 'Plant Operations Lead' }, { first: 'Martin', last: 'Groves', title: 'Quality Manager' }] },
  { name: 'Ledgerwood Paper', domain: 'ledgerwoodpaper.example', industry: 'Manufacturing', employees: 720, revenue: 165_000_000, city: 'Green Bay', region: 'WI', type: 'Prospect', description: 'Paper converter running three shifts and a large raw-material store.', owner: 'sofia', contacts: [{ first: 'Ernie', last: 'Kaminski', title: 'Mill Operations Manager' }] },
  { name: 'Vantage Auto Parts', domain: 'vantageauto.example', industry: 'Wholesale', employees: 1150, revenue: 330_000_000, city: 'Detroit', region: 'MI', type: 'Prospect', description: 'Aftermarket parts distributor with 40 branches and hourly delivery runs.', owner: 'maya', contacts: [{ first: 'Sandra', last: 'Villarreal', title: 'VP Supply Chain' }, { first: 'Leonard', last: 'Achebe', title: 'Regional Operations Manager' }] },
  { name: 'Birchwood Medical Group', domain: 'birchwoodmed.example', industry: 'Healthcare', employees: 2600, revenue: 720_000_000, city: 'Cleveland', region: 'OH', type: 'Prospect', description: 'Hospital group centralising supplies for eleven sites.', owner: 'daniel', contacts: [{ first: 'Cheryl', last: 'Aboagye', title: 'System Director of Supply Chain' }] },
  { name: 'Rampart Security Systems', domain: 'rampartsec.example', industry: 'Construction', employees: 290, revenue: 63_000_000, city: 'Phoenix', region: 'AZ', type: 'Prospect', description: 'Installs and services security systems from a central parts depot.', owner: 'hannah', contacts: [{ first: 'Felix', last: 'Duarte', title: 'Service Operations Manager' }] },
  { name: 'Tallgrass Distributing', domain: 'tallgrassdist.example', industry: 'Wholesale', employees: 470, revenue: 112_000_000, city: 'Omaha', region: 'NE', type: 'Prospect', description: 'Food service distributor serving schools and hospitals.', owner: 'sofia', contacts: [{ first: 'Dana', last: 'Petrov', title: 'Director of Warehousing' }] },
  { name: 'Coastline Rentals', domain: 'coastlinerentals.example', industry: 'Construction', employees: 360, revenue: 97_000_000, city: 'Tampa', region: 'FL', type: 'Customer', description: 'Equipment rental company tracking 4,000 assets across nine yards.', owner: 'daniel', contacts: [{ first: 'Owen', last: 'Brathwaite', title: 'Director of Operations' }] },
  { name: 'Summit Grain Handling', domain: 'summitgrain.example', industry: 'Agriculture', employees: 150, revenue: 38_000_000, city: 'Fargo', region: 'ND', type: 'Prospect', description: 'Grain elevator operator moving into contract storage.', owner: 'hannah', contacts: [{ first: 'Karl', last: 'Bergstrom', title: 'Facility Manager' }] },
  { name: 'Emberline Utilities', domain: 'emberlineutil.example', industry: 'Energy', employees: 1900, revenue: 560_000_000, city: 'Boise', region: 'ID', type: 'Prospect', description: 'Regional utility managing storerooms and crews across a wide service area.', owner: 'maya', contacts: [{ first: 'Renata', last: 'Silva', title: 'Director of Materials Management' }, { first: 'Hugh', last: 'Tanaka', title: 'Storeroom Supervisor' }] },
  { name: 'Wren & Vale Apparel', domain: 'wrenvale.example', industry: 'Retail', employees: 240, revenue: 52_000_000, city: 'Portland', region: 'OR', type: 'Partner', description: 'Apparel brand; also refers us to other brands on their fulfilment network.', owner: 'maya', contacts: [{ first: 'Simone', last: 'Adekunle', title: 'Head of Operations' }] },
];

export const PRODUCTS = [
  { name: 'Operations Platform — Starter', sku: 'PLAT-STR', price: 1200, billing: 'Monthly' as const, category: 'Platform', description: 'Up to two sites, standard workflows and reporting.' },
  { name: 'Operations Platform — Growth', sku: 'PLAT-GRW', price: 2600, billing: 'Monthly' as const, category: 'Platform', description: 'Up to six sites, automation rules and advanced reporting.' },
  { name: 'Operations Platform — Enterprise', sku: 'PLAT-ENT', price: 5400, billing: 'Monthly' as const, category: 'Platform', description: 'Unlimited sites, SSO, audit trail and a named success manager.' },
  { name: 'Additional site licence', sku: 'SITE-ADD', price: 420, billing: 'Monthly' as const, category: 'Platform', description: 'One extra warehouse, yard or depot.' },
  { name: 'Fleet module', sku: 'MOD-FLT', price: 900, billing: 'Monthly' as const, category: 'Modules', description: 'Vehicle assignment, inspections and maintenance scheduling.' },
  { name: 'Implementation — standard', sku: 'SVC-IMP', price: 12_000, billing: 'One-time' as const, category: 'Services', description: 'Configuration, data migration and go-live support for up to three sites.' },
  { name: 'Implementation — complex', sku: 'SVC-IMPX', price: 28_000, billing: 'One-time' as const, category: 'Services', description: 'Multi-site rollout with integrations and custom workflows.' },
  { name: 'Onsite training day', sku: 'SVC-TRN', price: 3_200, billing: 'One-time' as const, category: 'Services', description: 'A day with your supervisors and floor leads.' },
  { name: 'Premium support', sku: 'SUP-PRM', price: 9_600, billing: 'Annual' as const, category: 'Support', description: 'One-hour response, 24/7 coverage and a quarterly review.' },
];

/** Note bodies, so a timeline reads like people wrote it. */
export const CALL_NOTES = [
  'Caught {first} between shifts. They are still running the floor on spreadsheets and two whiteboards; the pain is shift handover.',
  'Quick check-in. Budget sits with {first}’s VP and the cycle starts in the next quarter.',
  'Left a voicemail and followed up by email with the two-site pricing.',
  'Went through the pilot plan. They want one site live before committing to the rest.',
  'They had a bad experience with a rollout two years ago, so references matter more than price here.',
  'Talked through integration with their WMS. Their IT lead wants to see the API docs before the demo.',
  'Short call — asked to pick it back up after their peak season ends.',
];

export const MEETING_NOTES = [
  'Ran the demo for {first} and two supervisors. Strong reaction to the shift handover board and the exception queue.',
  'Discovery session: four sites, 180 floor staff, three systems to sit beside. Their reporting takes a day a week to assemble.',
  'Walked the proposal line by line. They asked to move implementation into next quarter to match the budget year.',
  'Security review call with their IT lead. SOC 2 report sent afterwards; they still owe us the questionnaire.',
  'Quarterly review. Usage is up and they are about to add a third site.',
  'Pilot readout. Picking errors down noticeably; they want the same setup at the second warehouse.',
];

export const EMAIL_SUBJECTS = [
  'Following up on our call',
  'Two-site pricing, as promised',
  'Notes from the demo',
  'Security questionnaire + SOC 2',
  'Pilot plan for {company}',
  'Quick question on timing',
  'Implementation schedule',
];

export const EMAIL_BODIES = [
  'Hi {first},\n\nThanks for the time today. I’ve put the two-site pricing together with the implementation timeline so you can share it internally.\n\nHappy to jump on a short call with your IT lead if that helps them plan the integration work.\n\nBest,\n{sender}',
  'Hi {first},\n\nFollowing up on the demo. The exception queue we showed is the piece most teams tell us saves the first hour of the day, so I’ve included a short walkthrough video.\n\nWhat would make the most sense as a next step?\n\n{sender}',
  'Hi {first},\n\nAttached is our SOC 2 report and the answers to the first half of your security questionnaire. I’ll send the rest tomorrow once our security lead has reviewed it.\n\nThanks,\n{sender}',
  'Hi {first},\n\nChecking in on the proposal. No rush — I know the budget cycle starts next month. If it helps, I can hold the current pricing until the end of the quarter.\n\n{sender}',
];

export const NOTE_BODIES = [
  'Champion is {first}. They have run two rollouts before and know what to ask for.',
  'Procurement will need a W-9 and an updated insurance certificate before signature.',
  'They mentioned a competitor is already in one of their sites — worth asking which flows are missing.',
  'Peak season runs November to January; nothing will start before February.',
  'Their CFO wants a one-page business case rather than the full deck.',
];

// Wide enough that two open tasks rarely read the same line — a demo where every
// second row says "Follow up" looks like a bug even when it isn't.
export const TASK_TITLES = [
  'Send two-site pricing',
  'Follow up on the security questionnaire',
  'Book the technical demo',
  'Share the implementation timeline',
  'Check in after the pilot readout',
  'Introduce their IT lead to solutions engineering',
  'Send the reference call details',
  'Confirm the start date with procurement',
  'Draft the renewal quote',
  'Call back after peak season',
  'Write up the discovery notes',
  'Get the SOC 2 report over to their IT lead',
  'Ask who signs the order form',
  'Rework the scope to two sites',
  'Chase the signed order form',
  'Send the integration overview',
  'Book a call with their finance lead',
  'Put together the business case one-pager',
  'Confirm the go-live window',
  'Check whether budget moved to next quarter',
  'Send the onboarding plan',
  'Ask for an intro to the second site',
];

export const LEAD_MESSAGES = [
  'We run four distribution centres and are looking to replace a homegrown system this year. Would like to see a demo.',
  'Interested in the fleet module — we have 60 vans and no maintenance tracking today.',
  'Saw your talk at the logistics conference. Sending this on behalf of our operations director.',
  'Can you send pricing for two warehouses and about 40 users?',
  'We are comparing three systems and would like to understand your implementation timeline.',
  'Do you integrate with our current WMS? That would decide it for us.',
  '',
];

export const FIRST_NAMES = ['Ana', 'Ben', 'Carla', 'Derek', 'Elif', 'Farid', 'Grace', 'Hugo', 'Ines', 'Jamal', 'Kara', 'Liam', 'Mireille', 'Noor', 'Omar', 'Paloma', 'Quinn', 'Rafael', 'Sasha', 'Tomas', 'Ursula', 'Vikram', 'Wendy', 'Xiomara', 'Yusra', 'Zane'];
export const LAST_NAMES = ['Abbott', 'Baptiste', 'Cortez', 'Dunn', 'Eriksen', 'Fowler', 'Gutierrez', 'Hollis', 'Ivarsson', 'Jensen', 'Kaur', 'Larsen', 'Mensah', 'Nakamura', 'O’Rourke', 'Pineda', 'Quill', 'Rosenthal', 'Sandoval', 'Thiel', 'Ueda', 'Vargas', 'Wexler', 'Yoon', 'Zamora'];
export const LEAD_TITLES = ['Operations Manager', 'Director of Logistics', 'Warehouse Supervisor', 'VP Operations', 'Supply Chain Analyst', 'Plant Manager', 'Head of Fulfilment', 'General Manager', 'Fleet Manager', 'IT Director'];
export const LEAD_COMPANIES = ['Pallet & Pine', 'Redhawk Distribution', 'Bayline Foods', 'Orchard Street Supply', 'Union Rail Services', 'Blue Meridian Logistics', 'Camden Works', 'Two Rivers Produce', 'Hollow Creek Dairy', 'Standard Fabrication', 'Kingsway Retail', 'Portside Chemicals', 'Falcon Ridge Mining', 'Greenlight Couriers', 'Maple Court Pharmacy', 'Ironwood Lumber', 'Coastal Air Parts', 'Tri-State Recycling'];
