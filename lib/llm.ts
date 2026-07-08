import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'

// text-embedding-004 (768 dims, matching schema.sql's fixed vector(768)) was
// retired by Google. Its replacement, gemini-embedding-001, defaults to 3072
// dims but supports truncation via outputDimensionality — a param the legacy
// @google/generative-ai SDK's embedContent() types don't expose. Call the
// REST endpoint directly for this one thing instead of migrating the schema.
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIMENSIONS = 768

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBED_DIMENSIONS,
      }),
    }
  )
  if (!res.ok) {
    throw new Error(`Gemini embedContent failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.embedding.values
}

// Verdict generation is provider-agnostic (prompt in, JSON text out), so any
// configured chat model can do it. Embeddings stay on Gemini regardless
// (lib/pipeline.ts) — the pgvector column is a fixed vector(768), matching
// text-embedding-004, so swapping embedders would require re-ingesting the
// whole corpus.

export type LlmProvider = 'deepseek' | 'openai' | 'gemini'

const PRIORITY: LlmProvider[] = ['deepseek', 'openai', 'gemini']
const KEY_ENV_VAR: Record<LlmProvider, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

function configured(provider: LlmProvider): boolean {
  return !!process.env[KEY_ENV_VAR[provider]]
}

export function resolveProvider(): LlmProvider {
  const pinned = process.env.LLM_PROVIDER as LlmProvider | undefined
  if (pinned) {
    if (!PRIORITY.includes(pinned)) {
      throw new Error(`LLM_PROVIDER must be one of ${PRIORITY.join(', ')}, got "${pinned}"`)
    }
    if (!configured(pinned)) {
      throw new Error(`LLM_PROVIDER=${pinned} but its API key is not set`)
    }
    return pinned
  }
  const found = PRIORITY.find(configured)
  if (!found) {
    throw new Error(`No LLM API key configured. Set one of: ${PRIORITY.map((p) => KEY_ENV_VAR[p]).join(', ')}`)
  }
  return found
}

let geminiVerifyModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null
function getGeminiVerifyModel() {
  if (!geminiVerifyModel) {
    const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    geminiVerifyModel = gemini.getGenerativeModel({ model: 'gemini-1.5-flash' })
  }
  return geminiVerifyModel
}

let openaiClient: OpenAI | null = null
function getOpenAiClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
  }
  return openaiClient
}

let deepseekClient: OpenAI | null = null
function getDeepseekClient() {
  if (!deepseekClient) {
    // DeepSeek's API is OpenAI-compatible — same SDK, different base URL.
    deepseekClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      baseURL: 'https://api.deepseek.com',
    })
  }
  return deepseekClient
}

// Returns the raw text response — callers parse/validate (see safeParseVerdict).
export async function generateVerdictText(prompt: string, provider: LlmProvider): Promise<string> {
  switch (provider) {
    case 'gemini': {
      const res = await getGeminiVerifyModel().generateContent(prompt)
      return res.response.text()
    }
    case 'openai': {
      const res = await getOpenAiClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      })
      return res.choices[0]?.message?.content ?? ''
    }
    case 'deepseek': {
      const res = await getDeepseekClient().chat.completions.create({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      })
      return res.choices[0]?.message?.content ?? ''
    }
  }
}
