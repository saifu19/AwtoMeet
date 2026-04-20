import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet (2024) — argon2id with m>=19 MiB, t>=2, p=1.
// We run m=64 MiB, t=3, p=4 which exceeds the minimum and matches the library
// default but is pinned here so future library upgrades cannot silently weaken it.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
