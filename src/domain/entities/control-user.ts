export type ControlUserRole = 'admin' | 'operator';

export class ControlUser {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly name: string,
    readonly passwordHash: string | null,
    readonly role: ControlUserRole,
    readonly mustChangePassword: boolean,
    readonly firstAccessTokenHash: string | null,
    readonly isActive: boolean,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}
}
