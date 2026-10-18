/**
 * AI facade. Every task tries Gemini first and falls back to the offline
 * engine, reporting which engine answered and why a fallback happened.
 * Swapping in another provider means adding one adapter with generateJSON().
 */
import * as gemini from './gemini.mjs';
import { TRIAGE_SCHEMA, INSIGHT_SCHEMA, SOAP_SCHEMA, DOCUMENT_SCHEMA, validateTriage, validateInsight, validateSoap, validateDocument, SchemaError } from './schema.mjs';
import { triageSystem, INSIGHT_SYSTEM, SOAP_SYSTEM, DOCUMENT_SYSTEM, buildTriageInput, buildInsightInput, buildSoapInput, buildDocumentInput } from './prompts.mjs';
import { localTriage, localInsights, localSoap } from './local.mjs';

export function initAI() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) gemini.configure(key);
}

const offlineForced = () => process.env.NADI_AI === 'offline';

async function run({ gem, local, validate }) {
  const started = Date.now();
  if (!offlineForced() && gemini.isConfigured()) {
    try {
      const out = await gem();
      return { result: validate(out.json), engine: 'gemini', model: out.model, surface: out.surface, latencyMs: out.latencyMs, fallback: null };
    } catch (e) {
      const fallback = e instanceof SchemaError || e.badOutput
        ? { kind: 'bad_output', message: 'Gemini returned an answer that failed validation, so the offline engine answered instead.', detail: e.message }
        : gemini.describeError(e);
      return { result: local(), engine: 'offline', model: 'nadi-offline-1', latencyMs: Date.now() - started, fallback };
    }
  }
  return {
    result: local(), engine: 'offline', model: 'nadi-offline-1', latencyMs: Date.now() - started,
    fallback: offlineForced() ? { kind: 'forced', message: 'Offline mode is on (NADI_AI=offline).' } : { kind: 'not_configured', message: 'No Gemini API key configured — the offline clinical engine answered.' },
  };
}

export const aiTriage = (ctx, input) => run({
  // 'low' measured ~10 s vs ~20 s for 'medium' on gemini-3.8-flash with the same triage quality.
  gem: () => gemini.generateJSON({ system: triageSystem(ctx.language), input: buildTriageInput(input), schema: TRIAGE_SCHEMA, thinking: process.env.GEMINI_THINKING || 'low' }),
  local: () => localTriage(ctx),
  validate: validateTriage,
});

export const aiInsights = (language, summary, localArgs) => run({
  gem: () => gemini.generateJSON({ system: INSIGHT_SYSTEM(language), input: buildInsightInput(summary), schema: INSIGHT_SCHEMA, thinking: 'low' }),
  local: () => localInsights(summary, localArgs),
  validate: validateInsight,
});

export const aiSoap = (data) => run({
  gem: () => gemini.generateJSON({ system: SOAP_SYSTEM, input: buildSoapInput(data.forModel), schema: SOAP_SCHEMA, thinking: 'low' }),
  local: () => localSoap(data),
  validate: validateSoap,
});

/**
 * Reading a photo needs a vision model: there is no offline fallback, so this
 * either returns a validated reading or throws with a reason the UI can show.
 */
export async function aiReadDocument({ data, mimeType, language = 'en' }) {
  if (offlineForced() || !gemini.isConfigured()) {
    throw Object.assign(new Error(offlineForced() ? 'Offline mode is on (NADI_AI=offline).' : 'No Gemini API key configured.'), { needsAi: true });
  }
  const out = await gemini.generateJSON({ system: DOCUMENT_SYSTEM(language), input: buildDocumentInput({ data, mimeType }), schema: DOCUMENT_SCHEMA, thinking: 'low', timeoutMs: 75000 });
  return { result: validateDocument(out.json), engine: 'gemini', model: out.model, latencyMs: out.latencyMs };
}

export function aiStatus() {
  return { provider: !offlineForced() && gemini.isConfigured() ? 'gemini' : 'offline', offline_forced: offlineForced(), ...gemini.status() };
}

export const setGeminiKey = (key) => gemini.configure(key);
export const testGemini = () => gemini.testConnection();
export const describeAiError = gemini.describeError;
