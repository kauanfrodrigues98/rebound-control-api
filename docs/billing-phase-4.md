# Integração financeira - etapa 4

Esta entrega usa a branch `feature/billing-foundation`, criada da main local deste repositório. Não migra clientes, assinaturas Stripe ou licenças existentes.

O guia completo está em [Billing: etapa 4](../../rebound-dlq-billing/docs/phase-4-financial-portal.md).

Control exibe faturas reais em `/billing/invoices`, por cliente vinculado a `billing_accounts.customer_id`. Administradores configuram contato/meios, geram/revogam acesso, registram pagamento externo, reversão e referência da NF. Operadores apenas consultam. Nenhuma chave administrativa é enviada ao navegador.

Cliente acessa `/financial` por link temporário. Fragmento é removido na troca por cookie HttpOnly; credencial é validada por conta, prazo e revogação em cada operação. Consulta de cobrança recupera o boleto/Checkout existente. Baixa continua restrita ao financeiro.

## Configuração

- Control API: `BILLING_SERVICE_URL` (URL interna sem `/api`), `BILLING_ADMIN_API_KEY`, `CONTROL_FRONTEND_URL`/`CONTROL_ALLOWED_ORIGINS`, `COOKIE_SECURE=true` em produção.
- Control Nuxt: `NUXT_CONTROL_API_BASE_URL` incluindo `/api/v1`, `NUXT_CONTROL_FRONTEND_ORIGIN` com origem pública exata. Configuração privada no servidor.
- Billing: URL do portal, emissor, segredo de acesso, SMTP e flags de workers. Ver guia completo; notificações vêm desabilitadas por padrão.

Mutações financeiras exigem Origin válido. O Control API determina o ator pela sessão; não usa `x-operator-id` do navegador. Comandos monetários preservam Idempotency-Key em retentativas. Recibos em HTML/PDF são repassados com conteúdo e headers de download corretos e sem cache.

## Validação

Build aprovado. Control API: 8 testes Jest, 1 E2E isolado, lint dos arquivos alterados. Control Nuxt: 3 testes de utilitários/proxy; fluxo Chromium local com PostgreSQL isolado, PDF, boleto, baixa externa, revogação, IDOR, CSRF e viewport móvel.

Typecheck global do frontend mantém 23 diagnósticos app e 5 server já reproduzidos na main; novos arquivos financeiros não acrescentam diagnósticos. Não afirmar aprovação global de tipos. Homologação Stripe/webhooks/SMTP reais fica para o roteiro final, antes de produção.
