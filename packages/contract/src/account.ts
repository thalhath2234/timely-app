/**
 * Auth user as returned by /me and the login, register and refresh responses
 * (`userProfileResponse`). The onboarding flag is spelled in snake_case here
 * and nowhere else; see `Config` for the camelCase one.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  is_on_boarding_completed: boolean;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Create response only: `key` is shown once and never stored in clear. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

/** One entry of GET /sessions. */
export interface DeviceSession {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}
