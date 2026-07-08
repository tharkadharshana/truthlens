// Corpus, prompt, and verdict set are the three things that vary per domain.
// Everything else (embedding, retrieval, provider selection, API plumbing)
// is shared — see lib/pipeline.ts.

export type Domain = 'legal_statute' | 'finra_compliance'

export type DomainConfig = {
  label: string
  verdicts: readonly string[]
  notFoundVerdict: string       // returned when no corpus match clears SIM_THRESHOLD
  role: string                  // "You are a ___" — sets the reviewer persona
  sourceLabel: string           // e.g. "SOURCES" vs "REGULATORY RULES"
}

export const DOMAINS: Record<Domain, DomainConfig> = {
  legal_statute: {
    label: 'Legal statute claim-checking',
    verdicts: ['SUPPORTED', 'ALTERED', 'UNSUPPORTED', 'NOT_FOUND'],
    notFoundVerdict: 'NOT_FOUND',
    role: 'legal fact-checker',
    sourceLabel: 'SOURCES',
  },
  finra_compliance: {
    label: 'FINRA/SEC marketing compliance',
    verdicts: ['COMPLIANT', 'UNSUBSTANTIATED_CLAIM', 'PROHIBITED_PROMISE', 'MISSING_DISCLOSURE', 'NOT_FOUND'],
    notFoundVerdict: 'NOT_FOUND',
    role: 'FINRA/SEC marketing compliance reviewer, auditing financial advisor communications against FINRA Rule 2210 and SEC Marketing Rule 206(4)-1',
    sourceLabel: 'REGULATORY RULES',
  },
}

export const DEFAULT_DOMAIN: Domain = 'legal_statute'

export function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && value in DOMAINS
}
