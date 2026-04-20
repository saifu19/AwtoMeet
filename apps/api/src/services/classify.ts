import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import * as meetingTypesRepo from '../repositories/meeting-types.js';

// ── Structured output schema ────────────────────────────────────────
const ClassifyResponse = z.object({
  meeting_type_id: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});

// ── Lazy singleton OpenAI client ────────────────────────────────────
let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 3_000, // 3s hard cap per M51 spec
    });
  }
  return _client;
}

// ── System prompt ───────────────────────────────────────────────────
const SYSTEM_PROMPT =
  'You classify a meeting into one of the user\'s meeting types. ' +
  'Return JSON {"meeting_type_id": "<id>" | null, "confidence": 0..1, "reason": "<short>"}. ' +
  'Only pick an id from the provided list. Prefer null over a weak guess.';

// ── Main export ─────────────────────────────────────────────────────
export async function classifyMeetingType(
  userId: string,
  meeting: { title: string; description?: string | null },
): Promise<string | null> {
  const types = await meetingTypesRepo.listByOwner(userId);
  if (types.length === 0) return null;

  const options = types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));

  const userMessage =
    `Meeting: title="${meeting.title}", description="${meeting.description ?? ''}"\n` +
    `Options: ${JSON.stringify(options)}`;

  try {
    const completion = await getClient().chat.completions.parse({
      model: process.env.DEFAULT_LLM_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 150,
      response_format: zodResponseFormat(ClassifyResponse, 'classify_response'),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) return null;

    // Confidence threshold
    if (parsed.confidence < 0.5) return null;

    // Hallucination guard: ensure returned ID is in the user's list
    if (parsed.meeting_type_id && types.some((t) => t.id === parsed.meeting_type_id)) {
      return parsed.meeting_type_id;
    }

    return null;
  } catch (err) {
    // On ANY failure (timeout, network, refusal): log and proceed with null.
    // Never fail the meeting creation request because of classification.
    console.error('[classify] LLM classification failed, proceeding with null:', err);
    return null;
  }
}
