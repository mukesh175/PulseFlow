/**
 * Which model writes the workflow.
 *
 * The compiler is the one place a third-party model is involved, and it is
 * deliberately swappable: the definition it produces goes through the same
 * validator a hand-written one does, so a weaker model produces more rejections
 * rather than worse automations. That is what makes running this on a free tier
 * a reasonable thing to do.
 *
 * Whichever key is configured is used, in this order. Nothing is sent to more
 * than one provider, and if none is configured the description box is simply
 * not shown.
 *
 *   ANTHROPIC_API_KEY  → Claude
 *   GEMINI_API_KEY     → Gemini
 *   GROQ_API_KEY       → Groq
 *
 * **No customer data reaches any of them.** The request carries the merchant's
 * own sentence and their store name. Customer names, addresses and order
 * history are never part of it — the compiler writes the automation, it does
 * not run it.
 *
 * Raw fetch rather than three SDKs: each is one JSON POST, and the schema is
 * ours either way.
 */

/** Model ids move faster than this file does, so each is overridable. */
const DEFAULTS = {
  anthropic: 'claude-opus-5',
  gemini: 'gemini-3.6-flash',
  groq: 'llama-3.3-70b-versatile',
};

export function activeProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  return null;
}

export function providerLabel(provider) {
  return { anthropic: 'Claude', gemini: 'Gemini', groq: 'Groq' }[provider] ?? provider;
}

/**
 * Ask the configured provider for one JSON object matching `jsonSchema`.
 *
 * Returns the parsed object. Throws with a message safe to show a merchant —
 * the caller cannot fix a provider outage, and neither can they.
 */
export async function generateJson({ provider, system, user, jsonSchema, maxTokens = 8000 }) {
  switch (provider) {
    case 'anthropic':
      return anthropicJson({ system, user, jsonSchema, maxTokens });
    case 'gemini':
      return geminiJson({ system, user, jsonSchema, maxTokens });
    case 'groq':
      return groqJson({ system, user, jsonSchema, maxTokens });
    default:
      throw new Error(`No AI provider configured`);
  }
}

// ---------------------------------------------------------------------------

async function anthropicJson({ system, user, jsonSchema, maxTokens }) {
  const model = process.env.ANTHROPIC_MODEL || DEFAULTS.anthropic;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: jsonSchema } },
    }),
  });

  const payload = await readJson(response, 'Claude');

  // Thinking blocks come back alongside the answer; the JSON is in the text.
  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseJson(text, 'Claude');
}

async function geminiJson({ system, user, jsonSchema, maxTokens }) {
  const model = process.env.GEMINI_MODEL || DEFAULTS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(jsonSchema),
        maxOutputTokens: maxTokens,
      },
    }),
  });

  const payload = await readJson(response, 'Gemini');

  const blocked = payload.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Gemini declined the request (${blocked}).`);

  const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return parseJson(text, 'Gemini');
}

async function groqJson({ system, user, jsonSchema, maxTokens }) {
  const model = process.env.GROQ_MODEL || DEFAULTS.groq;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'workflow', strict: true, schema: jsonSchema },
      },
    }),
  });

  const payload = await readJson(response, 'Groq');
  return parseJson(payload.choices?.[0]?.message?.content ?? '', 'Groq');
}

// ---------------------------------------------------------------------------

/**
 * Gemini accepts a subset of JSON Schema and rejects the rest outright, so the
 * schema is trimmed rather than sent as-is. `additionalProperties` in
 * particular is refused — which is why the validator, not the schema, remains
 * the thing that catches an invented field.
 */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema') continue;

    // Gemini accepts `enum` only alongside `type: "string"`, and rejects the
    // whole request rather than ignoring it — an integer enum such as
    // `version: {type: "integer", enum: [1]}` fails with a 400. Dropping the
    // enum keeps the field; the prompt states the value and the validator
    // enforces it, which is where the real constraint lives anyway.
    if (key === 'enum' && schema.type !== 'string') continue;

    out[key] = toGeminiSchema(value);
  }
  return out;
}

async function readJson(response, name) {
  const text = await response.text();

  if (!response.ok) {
    // The provider's own message is often the useful part (quota exhausted,
    // unknown model), so it is surfaced rather than flattened to "failed".
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message ?? parsed.message ?? detail;
    } catch {
      // Not JSON — keep the raw prefix.
    }
    throw new Error(`${name} rejected the request (${response.status}): ${detail}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} returned a response that was not JSON.`);
  }
}

function parseJson(text, name) {
  const trimmed = String(text).trim();
  if (!trimmed) throw new Error(`${name} returned an empty response.`);

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap JSON in a fenced block despite being asked not to.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // fall through
      }
    }
    throw new Error(`${name} returned something that was not valid JSON.`);
  }
}
