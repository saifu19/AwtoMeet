import { Google, generateState, generateCodeVerifier } from 'arctic';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ??
  'http://localhost:3001/api/v0/auth/google/callback';

const google = new Google(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

export function getAuthorizationUrl(): {
  url: URL;
  state: string;
  codeVerifier: string;
} {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const scopes = ['openid', 'email', 'profile'];
  const url = google.createAuthorizationURL(state, codeVerifier, scopes);
  return { url, state, codeVerifier };
}

export async function validateAuthorizationCode(
  code: string,
  codeVerifier: string,
) {
  return google.validateAuthorizationCode(code, codeVerifier);
}

export async function fetchGoogleUser(
  accessToken: string,
): Promise<{ sub: string; email: string; name: string }> {
  const res = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    throw new Error(`Google userinfo request failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    sub: string;
    email: string;
    name: string;
  };

  return { sub: data.sub, email: data.email, name: data.name };
}
