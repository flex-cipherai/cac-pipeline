// Shipped defaults for the Automation scoper: the interview areas, ROI assumptions, limits and model names.
// Settings -> Automation scoper in the CRM overrides any of this (system_settings keys ga_*), and anything
// missing or malformed there falls back to these values. A TypeScript module (not JSON) so it imports the
// same way under Deno, Vite and Node.

const DEFAULTS = {
  settings: {
    enabled: true,
    model: 'gemini-3.6-flash',
    fallback_model: 'gemini-3.5-flash-lite',
    block_free_email: true,
    min_user_turns: 8,
    max_user_turns: 28,
    min_areas_covered: 6
  },
  instructions: '',
  areas: [
    {
      key: 'sales',
      label: 'Sales and lead handling',
      focus: 'How enquiries arrive (WhatsApp, calls, walk-ins, website, referrals), who replies and how fast, how leads are followed up and quoted, what gets lost, whether any CRM or lead list exists.',
      optional: false
    },
    {
      key: 'customer_service',
      label: 'Customer communication and support',
      focus: 'Volume of customer messages and calls, the questions that get asked over and over, response times, complaints, after-sales follow-up, who handles WhatsApp and how.',
      optional: false
    },
    {
      key: 'operations',
      label: 'Core operations and workflows',
      focus: 'How the main work gets done from order to delivery, hand-offs between people, manual steps and paperwork, scheduling or dispatch, errors and rework, anything that depends on one person.',
      optional: false
    },
    {
      key: 'finance',
      label: 'Finance, invoicing and collections',
      focus: 'Quoting and invoicing, mobile-money and bank reconciliation, tax filing and compliance effort, payroll, expense tracking, chasing late payers, how long month-end takes.',
      optional: false
    },
    {
      key: 'people_admin',
      label: 'People and administration',
      focus: 'Attendance and shifts, leave, recruitment and onboarding, staff records and documents, approvals, internal communication.',
      optional: false
    },
    {
      key: 'inventory',
      label: 'Inventory, procurement and suppliers',
      focus: 'Stock counts, reordering, supplier quotes and orders, losses and stock-outs, asset tracking. Skip if the business holds no stock and buys little.',
      optional: true
    },
    {
      key: 'data_reporting',
      label: 'Data, reporting and decisions',
      focus: 'Where business data lives (paper, Excel, apps), how the owner sees how the business is doing, how long reports take to produce, what decisions are made on gut feel.',
      optional: false
    },
    {
      key: 'tech_readiness',
      label: 'Tools, systems and AI readiness',
      focus: 'Software already in use and whether it is connected, who looks after technology, how comfortable staff are with new tools and AI, past attempts that failed, data privacy worries.',
      optional: false
    }
  ],
  // In-depth reviews of one department. The visitor picks "the whole business" (the areas above) or one
  // of these; the interview then covers that department's topics in depth and the report scores each topic.
  departments: [
    {
      key: 'sales',
      label: 'Sales and lead handling',
      blurb: 'From the first enquiry to a signed customer.',
      topics: [
        { key: 'lead_sources', label: 'Where leads come from', focus: 'Every channel enquiries arrive through (WhatsApp, calls, walk-ins, website, social, referrals, tenders), weekly volume per channel, which channels bring the best customers, whether the source of each lead is recorded.' },
        { key: 'response', label: 'Speed and quality of first response', focus: 'Who answers new enquiries, how fast (minutes, hours, days), what happens out of hours and at weekends, standard answers to common questions, enquiries that never get a reply.' },
        { key: 'follow_up', label: 'Follow-up and pipeline', focus: 'How open leads are tracked (memory, notebook, spreadsheet, CRM), how many follow-ups happen before giving up, how the owner sees what is in the pipeline, leads that go cold, conversion rate from enquiry to sale.' },
        { key: 'quoting', label: 'Quotes and proposals', focus: 'How quotes are prepared, how long each takes, who must approve prices, errors and re-quotes, how many quotes are sent per week and what share is won, chasing quotes that got no answer.' },
        { key: 'closing', label: 'Closing and handover', focus: 'Contracts, deposits and order confirmation, how a won deal is handed to operations or delivery, information re-typed between people, mistakes at handover.' },
        { key: 'retention', label: 'Repeat business and referrals', focus: 'How past customers are kept in touch with, repeat-purchase reminders, upselling, asking for referrals and reviews, knowing which customers have gone quiet.' },
      ],
    },
    {
      key: 'marketing',
      label: 'Marketing and content',
      blurb: 'How the business gets seen and generates demand.',
      topics: [
        { key: 'audience', label: 'Audience and positioning', focus: 'Who the ideal customer is, how clearly that is written down, the message used to reach them, how the business stands out from competitors.' },
        { key: 'content', label: 'Content production', focus: 'Which channels they post on, how often, who creates content, hours spent per week, how ideas are planned, approvals, reuse of content across channels.' },
        { key: 'campaigns', label: 'Campaigns and advertising', focus: 'Paid ads, promotions and email or WhatsApp broadcasts, how campaigns are planned and launched, monthly spend, how results are judged.' },
        { key: 'lead_capture', label: 'Turning attention into enquiries', focus: 'Website, landing pages and forms, links in posts, what a visitor is asked to do next, how enquiries from marketing reach sales, lost enquiries.' },
        { key: 'measurement', label: 'Measuring what works', focus: 'Which numbers they track (reach, clicks, enquiries, sales by channel), tools used, whether they know cost per lead or customer, how often results are reviewed.' },
        { key: 'brand_reputation', label: 'Reviews and reputation', focus: 'How reviews and testimonials are collected, responding to comments and complaints in public, consistency of brand across channels.' },
      ],
    },
    {
      key: 'customer_service',
      label: 'Customer service and support',
      blurb: 'Every conversation with a customer after they buy.',
      topics: [
        { key: 'channels', label: 'Channels and volume', focus: 'How customers get in touch (WhatsApp, calls, email, walk-ins, social), messages or calls per day, peak times, how many people handle them.' },
        { key: 'repeat_questions', label: 'Repeated questions', focus: 'The questions asked over and over (prices, order status, opening hours, how-to), share of all messages they make up, whether standard answers exist.' },
        { key: 'response_times', label: 'Response and resolution times', focus: 'How fast customers get a first answer and a fix, out-of-hours cover, messages that slip through, how long a typical issue takes to close.' },
        { key: 'tracking', label: 'Tracking issues and complaints', focus: 'Whether issues are logged anywhere, how they are handed between people, knowing which are open, escalation, learning from complaints.' },
        { key: 'knowledge', label: 'Knowledge and consistency', focus: 'Where answers and procedures are written down, how new staff learn them, whether customers get different answers from different people, dependence on one experienced person.' },
        { key: 'feedback', label: 'Feedback and satisfaction', focus: 'Whether satisfaction is measured, follow-up after an issue, how feedback reaches management, churn of unhappy customers.' },
      ],
    },
    {
      key: 'operations',
      label: 'Operations and delivery',
      blurb: 'How the core work gets done, from order to delivery.',
      topics: [
        { key: 'order_intake', label: 'Order and job intake', focus: 'How orders or jobs arrive and are recorded, information that is missing or re-typed, volume per week, how work is confirmed with the customer.' },
        { key: 'scheduling', label: 'Planning and scheduling', focus: 'How work, staff, vehicles or equipment are scheduled, who does it and how long it takes, last-minute changes, double bookings, idle time.' },
        { key: 'execution', label: 'Doing the work', focus: 'The main steps of the work, hand-offs between people or teams, paperwork and approvals, steps that depend on one person, bottlenecks and waiting time.' },
        { key: 'quality', label: 'Quality, errors and rework', focus: 'How quality is checked, how often mistakes or rework happen and what they cost, returns, how errors are recorded and learned from.' },
        { key: 'status_visibility', label: 'Status and visibility', focus: 'How the owner or customer knows where a job is, time spent answering "where is my order", updates to customers, delays discovered too late.' },
        { key: 'documentation', label: 'Procedures and documents', focus: 'Whether processes are written down, job cards, checklists, certificates and delivery notes, how documents are stored and found.' },
      ],
    },
    {
      key: 'finance',
      label: 'Finance and administration',
      blurb: 'Invoicing, collections, payments and the month-end close.',
      topics: [
        { key: 'invoicing', label: 'Invoicing', focus: 'How invoices are created and sent, how long it takes, delays between delivery and invoice, errors, number of invoices per month.' },
        { key: 'collections', label: 'Collections and late payers', focus: 'How payment status is tracked, debtor days, how late payers are reminded and by whom, money written off, cash-flow surprises.' },
        { key: 'reconciliation', label: 'Payments and reconciliation', focus: 'Mobile money, bank and card payments coming in, matching payments to invoices, hours spent reconciling, unmatched payments.' },
        { key: 'expenses', label: 'Expenses and purchasing', focus: 'How expenses and supplier bills are approved, recorded and paid, receipts, petty cash, budget control.' },
        { key: 'payroll_tax', label: 'Payroll, tax and compliance', focus: 'Payroll preparation, statutory deductions, tax filings, penalties paid, time spent each month, dependence on an outside accountant.' },
        { key: 'reporting', label: 'Financial reporting', focus: 'How long the month-end close takes, which reports the owner gets (profit, cash, margins by product or customer), how up to date the numbers are, decisions made without figures.' },
      ],
    },
    {
      key: 'people_admin',
      label: 'People and HR',
      blurb: 'Hiring, onboarding, attendance, leave and staff records.',
      topics: [
        { key: 'recruitment', label: 'Recruitment', focus: 'How many hires a year, where candidates come from, screening CVs, scheduling interviews, time to hire, bad hires.' },
        { key: 'onboarding', label: 'Onboarding and training', focus: 'How new staff learn the job, written materials, time until they are productive, who trains them and how much of their time it takes.' },
        { key: 'attendance', label: 'Attendance, shifts and leave', focus: 'How attendance and overtime are recorded, shift rosters, leave requests and balances, disputes, time spent preparing this for payroll.' },
        { key: 'records', label: 'Staff records and documents', focus: 'Contracts, IDs and certificates, where they are kept, expiry of licences or permits, finding a document quickly.' },
        { key: 'performance', label: 'Performance and targets', focus: 'How targets are set and tracked, reviews, how performance data is gathered, incentives and commissions calculation.' },
        { key: 'internal_comms', label: 'Internal communication and approvals', focus: 'How instructions and updates reach staff (WhatsApp groups, meetings), approvals that wait on the owner, information that gets lost.' },
      ],
    },
    {
      key: 'inventory',
      label: 'Inventory and procurement',
      blurb: 'Stock, suppliers, purchasing and assets.',
      topics: [
        { key: 'stock_records', label: 'Stock records and counts', focus: 'How stock levels are recorded (paper, Excel, system), how often counts happen and how long they take, differences between records and reality.' },
        { key: 'reordering', label: 'Reordering', focus: 'How the business decides when and how much to reorder, stock-outs and lost sales, overstock and expired or slow-moving items.' },
        { key: 'suppliers', label: 'Suppliers and purchasing', focus: 'How quotes are requested and compared, purchase orders, approvals, supplier lead times and reliability, price tracking.' },
        { key: 'receiving', label: 'Receiving and storage', focus: 'Checking deliveries against orders, damaged or short deliveries, storage locations, finding items, multiple stores or branches.' },
        { key: 'losses', label: 'Losses and shrinkage', focus: 'Theft, damage, expiry and unexplained losses, their size per month, how they are discovered.' },
        { key: 'assets', label: 'Assets and equipment', focus: 'Tracking tools, vehicles and equipment, maintenance schedules, breakdowns and downtime.' },
      ],
    },
    {
      key: 'data_reporting',
      label: 'Data, reporting and IT',
      blurb: 'Where information lives and how decisions get made.',
      topics: [
        { key: 'data_sources', label: 'Where data lives', focus: 'Every place business information is kept (paper, Excel, apps, WhatsApp, email), duplicates, which is the source of truth.' },
        { key: 'reports', label: 'Reports and dashboards', focus: 'Which reports exist, who prepares them, how many hours each takes, how current they are, whether anyone reads them.' },
        { key: 'decisions', label: 'Decision-making', focus: 'The decisions made each week or month, which are based on figures and which on gut feel, questions the owner cannot answer quickly today.' },
        { key: 'systems', label: 'Systems and integration', focus: 'Software in use and what it costs, whether systems talk to each other, re-typing between them, licences unused.' },
        { key: 'security', label: 'Security, backup and access', focus: 'Backups, shared passwords, who can see what, what happens if a laptop or phone is lost, data protection obligations.' },
        { key: 'skills', label: 'Skills and AI readiness', focus: 'Who looks after technology, staff comfort with new tools and AI, past projects that failed, appetite for change.' },
      ],
    },
  ],
  solution_types: {
    automation: 'Workflow automation',
    ai_assistant: 'AI assistant',
    system: 'Business system',
    data: 'Data and reporting',
    process: 'Process redesign'
  },
  roi: {
    hourly_cost_kes: 600,
    min_hourly_cost_kes: 150,
    max_hourly_cost_kes: 5000,
    working_weeks_per_year: 48,
    max_hours_per_person_per_week: 25,
    effectiveness: {
      automation: 0.7,
      ai_assistant: 0.45,
      system: 0.6,
      data: 0.4,
      process: 0.3
    },
    revenue_capture: 0.3,
    max_revenue_value_per_gap_year_kes: 12000000,
    confidence_factor: {
      low: 0.6,
      medium: 0.85,
      high: 1
    },
    range_low: 0.7,
    range_high: 1.3,
    investment_months_of_benefit: {
      automation: 5,
      ai_assistant: 4,
      system: 7,
      data: 6,
      process: 2
    },
    min_investment_per_gap_kes: 80000,
    max_benefit_per_staff_kes: 700000,
    rounding_kes: 1000
  },
  // Currencies a visitor can pick for the report. The ROI engine works in KES; figures are converted at
  // the end. kes_per_unit is approximate (refresh it now and then), labour scales the KES labour-cost
  // assumptions above for markets where staff time costs more or less than the Kenyan default (1 = as KES),
  // step is the rounding of the figures shown in that currency.
  currencies: {
    KES: { name: 'Kenyan shilling', kes_per_unit: 1, labour: 1, step: 1000 },
    USD: { name: 'US dollar', kes_per_unit: 129.4, labour: 5, step: 10 },
    EUR: { name: 'Euro', kes_per_unit: 149, labour: 5, step: 10 },
    GBP: { name: 'British pound', kes_per_unit: 174, labour: 5, step: 10 },
    AED: { name: 'UAE dirham', kes_per_unit: 35.2, labour: 2.5, step: 50 },
    CAD: { name: 'Canadian dollar', kes_per_unit: 94, labour: 5, step: 10 },
    AUD: { name: 'Australian dollar', kes_per_unit: 85, labour: 6, step: 10 },
    ZAR: { name: 'South African rand', kes_per_unit: 7.4, labour: 1.5, step: 100 },
    INR: { name: 'Indian rupee', kes_per_unit: 1.47, labour: 0.8, step: 1000 },
    NGN: { name: 'Nigerian naira', kes_per_unit: 0.086, labour: 0.6, step: 10000 }
  }
}

export default DEFAULTS
