// Corpus, prompt, and verdict set are the three things that vary per domain.
// Everything else (embedding, retrieval, provider selection, API plumbing)
// is shared — see lib/pipeline.ts.

export type Domain = 'legal_statute' | 'finra_compliance' | 'general'

export type DomainConfig = {
  label: string
  verdicts: readonly string[]
  notFoundVerdict: string       // returned when no corpus/web match clears the bar
  role: string                  // "You are a ___" — sets the reviewer persona
  sourceLabel: string           // e.g. "SOURCES" vs "REGULATORY RULES"
  evidence: 'corpus' | 'web'    // corpus = pgvector match_corpus; web = lib/evidence.ts
  // When retrieval finds nothing, may the model answer from its own training
  // knowledge (clearly labelled, confidence-capped, never with a citation)?
  // TRUE only for consumer general-purpose checking. Legal/compliance verdicts
  // must stay strictly source-backed — a professional acting on a remembered
  // statute is exactly the failure this product exists to prevent.
  allowModelKnowledge: boolean
}

export const DOMAINS: Record<Domain, DomainConfig> = {
  legal_statute: {
    label: 'Legal statute claim-checking',
    verdicts: ['SUPPORTED', 'ALTERED', 'UNSUPPORTED', 'NOT_FOUND'],
    notFoundVerdict: 'NOT_FOUND',
    role: 'legal fact-checker',
    sourceLabel: 'SOURCES',
    evidence: 'corpus',
    allowModelKnowledge: false,
  },
  finra_compliance: {
    label: 'FINRA/SEC marketing compliance',
    verdicts: ['COMPLIANT', 'UNSUBSTANTIATED_CLAIM', 'PROHIBITED_PROMISE', 'MISSING_DISCLOSURE', 'NOT_FOUND'],
    notFoundVerdict: 'NOT_FOUND',
    role: 'FINRA/SEC marketing compliance reviewer, auditing financial advisor communications against FINRA Rule 2210 and SEC Marketing Rule 206(4)-1',
    sourceLabel: 'REGULATORY RULES',
    evidence: 'corpus',
    allowModelKnowledge: false,
  },
  general: {
    label: 'General fact-checking',
    verdicts: ['TRUE', 'MOSTLY_TRUE', 'MISLEADING', 'FALSE', 'UNVERIFIABLE'],
    notFoundVerdict: 'UNVERIFIABLE',
    role: 'rigorous fact-checker. Judge the claim ONLY against the provided evidence. If the evidence is insufficient to reach a verdict, respond UNVERIFIABLE — never rely on your own prior knowledge',
    sourceLabel: 'EVIDENCE',
    evidence: 'web',
    allowModelKnowledge: true,
  },
}

export const DEFAULT_DOMAIN: Domain = 'legal_statute'

// Shown in every API response and on the landing page. Interim stopgap
// pending real legal review — plain, standard wording, not a substitute
// for one. See memory: production-readiness-gaps item 2.
export const DISCLAIMER =
  'This verdict is AI-generated and informational only. It is not legal, financial, or compliance advice, ' +
  'and does not substitute for review by a qualified professional. Verify independently before relying on it.'

export function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && value in DOMAINS
}
