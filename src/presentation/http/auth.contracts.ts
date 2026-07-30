import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Informe um email válido.').toLowerCase(),
  password: z.string().min(1, 'Informe sua senha.'),
});

export type LoginBody = z.infer<typeof loginSchema>;

const strongPasswordSchema = z
  .string()
  .min(12, 'A senha deve ter pelo menos 12 caracteres.')
  .regex(/[A-Z]/, 'A senha deve ter pelo menos uma letra maiúscula.')
  .regex(/[a-z]/, 'A senha deve ter pelo menos uma letra minúscula.')
  .regex(/[0-9]/, 'A senha deve ter pelo menos um número.')
  .regex(/[^A-Za-z0-9]/, 'A senha deve ter pelo menos um caractere especial.');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirme a nova senha.'),
  })
  .refine((body) => body.newPassword === body.confirmPassword, {
    path: ['confirmPassword'],
    message: 'A confirmação precisa ser igual à nova senha.',
  });

export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;

export const firstAccessSchema = z
  .object({
    email: z.string().trim().email('Informe um email válido.').toLowerCase(),
    setupToken: z.string().trim().min(1, 'Informe a chave de primeiro acesso.'),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirme a nova senha.'),
  })
  .refine((body) => body.newPassword === body.confirmPassword, {
    path: ['confirmPassword'],
    message: 'A confirmação precisa ser igual à nova senha.',
  });

export type FirstAccessBody = z.infer<typeof firstAccessSchema>;
