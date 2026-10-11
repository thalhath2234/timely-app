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

/**
 * PUT /me (`updateProfileRequest`). The server takes plain strings, so an
 * empty or absent password pair means "do not change the password".
 */
export interface UpdateMePayload {
  name: string;
  email: string;
  currentPassword?: string;
  newPassword?: string;
}

/** DELETE /me (`deleteAccountRequest`): the password confirms the delete. */
export interface DeleteAccountPayload {
  password: string;
}

/** DELETE /me response once the account and its data are gone. */
export interface DeleteAccountResult {
  message: string;
  /** Whether POST /register accepts an account now (sign-up vs sign-in). */
  registrationOpen: boolean;
  /** No account is left on this server. */
  lastAccount: boolean;
}
