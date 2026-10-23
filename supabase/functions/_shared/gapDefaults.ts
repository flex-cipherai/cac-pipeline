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
