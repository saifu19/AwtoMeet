import { AgentDispatchClient } from 'livekit-server-sdk';

const AGENT_NAME = 'meet-transcriber';

/**
 * Dispatches a worker agent for the meeting room.
 * Returns the dispatch ID on success, or null if already exists.
 */
export async function dispatchMeetingWorker(opts: {
  meetingId: string;
  roomName: string;
}): Promise<string | null> {
  const host = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!host || !apiKey || !apiSecret) {
    throw new Error(
      'LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set',
    );
  }

  const client = new AgentDispatchClient(host, apiKey, apiSecret);

  try {
    const dispatch = await client.createDispatch(opts.roomName, AGENT_NAME, {
      metadata: JSON.stringify({ meeting_id: opts.meetingId }),
    });
    return dispatch.id;
  } catch (err: unknown) {
    if (isAlreadyExistsError(err)) return null;
    throw err;
  }
}

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'already_exists' ||
    (e.message?.toLowerCase().includes('already exists') ?? false)
  );
}
