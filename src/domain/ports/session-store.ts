export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionStore {
  saveRefreshSession(input: {
    sessionId: string;
    userId: string;
    tokenHash: string;
    ttlSeconds: number;
  }): Promise<void>;
  getRefreshSession(sessionId: string): Promise<{ userId: string; tokenHash: string } | null>;
  deleteRefreshSession(sessionId: string): Promise<void>;
}
