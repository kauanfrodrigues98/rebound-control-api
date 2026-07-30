import { ControlUser } from '../entities/control-user';

export const CONTROL_USER_REPOSITORY = Symbol('CONTROL_USER_REPOSITORY');

export interface ControlUserRepository {
  count(): Promise<number>;
  findByEmail(email: string): Promise<ControlUser | null>;
  findById(id: string): Promise<ControlUser | null>;
  createAdmin(input: {
    email: string;
    name: string;
    passwordHash: string | null;
    mustChangePassword: boolean;
    firstAccessTokenHash: string;
  }): Promise<ControlUser>;
  updatePassword(input: {
    userId: string;
    passwordHash: string;
    mustChangePassword: boolean;
    firstAccessTokenHash?: string | null;
  }): Promise<void>;
  updateFirstAccessToken(input: {
    userId: string;
    firstAccessTokenHash: string;
  }): Promise<void>;
}
