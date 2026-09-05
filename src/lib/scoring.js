// Lead Qualification Scoring Logic
// Based on the CAC Lead Qualification Questions document

export const QUALIFICATION_QUESTIONS = {
  q1: {
    question: "What is your company's approximate annual revenue?",
    options: [
      { label: 'Below KES 10 million', value: 'below_10m', points: 0, disqualifier: true },
      { label: 'KES 10 million – 50 million', value: '10m_50m', points: 2 },
      { label: 'KES 50 million – 100 million', value: '50m_100m', points: 3 },
      { label: 'KES 100 million – 500 million', value: '100m_500m', points: 4 },
      { label: 'Above KES 500 million', value: 'above_500m', points: 4 },
    ]
  },
  q2: {
    question: "What best describes your current business challenge?",
    options: [
      { label: 'Curious about AI, no specific problem', value: 'curious', points: 1 },
      { label: "A process that isn't working well", value: 'process_issue', points: 3 },
      { label: "Tried to fix a problem, solutions haven't worked", value: 'tried_fix', points: 4 },
      { label: 'A manual process is costing us significant time or money and we need it fixed', value: 'costly_manual', points: 5 },
    ]
  },
  q3: {
    question: 'What is your role in this decision?',
    options: [
      { label: "I'm researching options on behalf of someone else", value: 'researcher', points: 0, disqualifier: true },
      { label: 'I influence the decision but need approval from someone above me', value: 'influencer', points: 2 },
      { label: "I'm the decision-maker with budget authority", value: 'decision_maker', points: 4 },
    ]
  },
  q4: {
    question: 'What matters most to you in this project?',
    options: [
      { label: 'Getting the lowest possible price', value: 'lowest_price', points: 0, disqualifier: true },
      { label: 'Getting it done as fast as possible', value: 'speed', points: 3 },
      { label: 'Getting a solution tailored to how my business actually operates', value: 'tailored', points: 4 },
      { label: 'Achieving measurable results — time saved, costs reduced or revenue increased', value: 'results', points: 4 },
    ]
  },
  q5: {
    question: 'How soon are you looking to get started?',
    options: [
      { label: 'Just exploring — no specific timeline', value: 'exploring', points: 1 },
      { label: 'Within the next 3 to 6 months', value: '3_6_months', points: 2 },
      { label: 'Within the next 1 to 3 months', value: '1_3_months', points: 3 },
      { label: 'As soon as possible', value: 'asap', points: 4 },
    ]
  }
}

export const CLASSIFICATION_THRESHOLDS = {
  hot: { min: 17, max: 21, label: 'Hot' },
  warm: { min: 10, max: 16, label: 'Warm' },
  cold: { min: 0, max: 9, label: 'Cold' },
}

export const HARD_DISQUALIFIERS = [
  { question: 'Q1', response: 'Below KES 10 million' },
  { question: 'Q3', response: 'Researching on behalf of someone else' },
  { question: 'Q4', response: 'Lowest possible price' },
]

export function scoreLead(responses) {
  const questions = QUALIFICATION_QUESTIONS
  let totalScore = 0
  let isDisqualified = false
  let disqualifierReason = null
  const scores = {}

  // Score each question
  for (const [key, question] of Object.entries(questions)) {
    const selectedValue = responses[key]
    const option = question.options.find(o => o.value === selectedValue)

    if (option) {
      scores[`${key}_score`] = option.points
      totalScore += option.points

      if (option.disqualifier) {
        isDisqualified = true
        disqualifierReason = `${key.toUpperCase()}: ${option.label}`
      }
    } else {
      scores[`${key}_score`] = 0
    }
  }

  // Determine classification
  let classification = 'cold'
  if (!isDisqualified) {
    if (totalScore >= CLASSIFICATION_THRESHOLDS.hot.min) {
      classification = 'hot'
    } else if (totalScore >= CLASSIFICATION_THRESHOLDS.warm.min) {
      classification = 'warm'
    }
  }

  return {
    q1_score: scores.q1_score || 0,
    q2_score: scores.q2_score || 0,
    q3_score: scores.q3_score || 0,
    q4_score: scores.q4_score || 0,
    q5_score: scores.q5_score || 0,
    total_score: totalScore,
    classification,
    is_disqualified: isDisqualified,
    disqualifier_reason: disqualifierReason,
  }
}

// Pipeline stages in order
export const PIPELINE_STAGES = [
  { key: 'Scheduled', label: 'Scheduled', description: 'Discovery call confirmed' },
  { key: 'Call Done', label: 'Call Done', description: 'Discovery call completed' },
  { key: 'Questions Prep', label: 'Questions Prep', description: 'Assessment questions prepared' },
  { key: 'Questions Sent', label: 'Questions Sent', description: 'Questions sent to lead' },
  { key: 'Responses In', label: 'Responses In', description: 'Lead submitted responses' },
  { key: 'Report Prep', label: 'Report Prep', description: 'Gap Assessment Report in preparation' },
  { key: 'Presented', label: 'Presented', description: 'Report presented to lead' },
  { key: 'Contract Out', label: 'Contract Out', description: 'Contract sent to lead' },
  { key: 'Converted', label: 'Converted', description: 'Contract signed — client acquired' },
]

// Estimated pipeline value based on lead's revenue tier (midpoint of pricing range)
export function estimatePipelineValue(q1_revenue) {
  const valueMap = {
    'Below KES 10 million': 0,
    'KES 10 million – 50 million': 500000,       // Tier 1 midpoint: 250K–750K
    'KES 50 million – 100 million': 1125000,      // Tier 2 midpoint: 750K–1.5M
    'KES 100 million – 500 million': 2750000,     // Tier 3 midpoint: 1.5M–4M
    'Above KES 500 million': 5750000,             // Tier 4 midpoint: 4M–7.5M
  }
  return valueMap[q1_revenue] || 0
}

// Day of week mapping
export const DAYS_OF_WEEK = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
]
