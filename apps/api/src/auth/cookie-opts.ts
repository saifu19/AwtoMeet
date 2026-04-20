export interface CrossSiteCookieOpts {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  path: string;
  maxAge: number;
}

// Web (Vercel) and api (Forge) often live on different eTLD+1s. On cross-site
// deployments, browsers only send/set cookies with SameSite=None; Secure on
// XHR — a same-site default (Lax) silently drops them. Opt in via
// CROSS_SITE_COOKIES=true. Resolved per-call so tests can flip the env at
// runtime; the cost is a single property lookup.
export function crossSiteCookieOpts(
  path: string,
  maxAge: number,
): CrossSiteCookieOpts {
  const crossSite = process.env.CROSS_SITE_COOKIES === 'true';
  return {
    httpOnly: true,
    secure: crossSite || process.env.NODE_ENV === 'production',
    sameSite: crossSite ? 'none' : 'lax',
    path,
    maxAge,
  };
}
