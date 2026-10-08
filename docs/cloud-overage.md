# Excedentes Cloud

O Control autoriza preços de excedentes no contrato; o cliente opta pelo uso excedente no console Rebound. Os preços são inteiros em centavos por unidade e fazem parte da versão imutável das condições comerciais. Publicar preço não ativa o opt-in do cliente.

## Configuração

1. No Control, abra o cliente e seu contrato Cloud pago. Em **Condições comerciais → Registrar nova versão**, configure **Excedentes autorizados no contrato** para eventos DLQ, análises IA e reprocessamentos. Campo vazio desautoriza o recurso. Registre o motivo e publique/sincronize a versão.
2. O acesso e as tarifas passam a seguir a versão que efetivamente concede acesso ao cliente, respeitando o fluxo de ativação financeira existente. Uma versão futura ou ainda não ativada não deve ser tratada como preço vigente.
3. No Rebound, o administrador do workspace abre **Minha conta → Configurações**, seleciona **Cobrar excedente** nos recursos desejados e aplica as alterações. Sem preço contratado, a opção não aparece. O padrão continua sendo bloquear no limite.
4. O resumo de uso exibe a quantidade excedente e os valores acumulados. Alterar o preço não recalcula consumo já registrado. Remover a autorização comercial faz a sincronização voltar a política do recurso para bloqueio.

Free, cortesia e self-hosted não autorizam cobranças de excedentes. A conta local Enterprise cortesia continua sem cobranças; para testar opt-in, use um contrato Cloud com cobrança normal e tarifa explícita.

## Fechamento e cobrança

- A franquia usa o mês do calendário em UTC, independentemente do timezone de exibição ou da periodicidade da assinatura.
- API registra contadores, valor e registro pendente de envio na mesma transação. Workers entregam API → Control → Billing a cada minuto quando `INTERNAL_BILLING_ENABLED=true`.
- A entrega exige confirmação de todos os registros; falhas mantêm registros pendentes e reagendam a tentativa. IDs duplicados com conteúdo idêntico não repetem cobrança; conteúdo diferente com o mesmo ID é rejeitado.
- Billing fecha meses encerrados após 24 horas de tolerância. Gera uma fatura de excedentes separada da assinatura, com vencimento em sete dias e meios de pagamento permitidos pelo contrato.
- Cada fatura mantém a versão comercial e os preços usados. Registros tardios ou lotes adicionais geram fatura complementar. Registros já vinculados a uma fatura não são faturados novamente.
- Reprocessamentos manuais e automáticos consomem a franquia de replay. Reexecuções do mesmo job de replay não duplicam a contagem.
- As faturas usam o fluxo financeiro existente: consulta, pagamento, conciliação e inadimplência. Pagamento do excedente não renova por si só a assinatura.

## Publicação

Projetos: `rebound-dlq-api`, `rebound-dlq-billing`, `rebound-control-api`, `rebound-control`, `rebound-dlq-front`.

Antes de publicar o código, aplique as migrações do Billing e da API pelos procedimentos normais de cada projeto:

- Billing: `20261008183956_cloud-usage-charges` cria o ledger financeiro.
- API: `1791500000000-cloud_usage_outbox` adiciona contadores monetários, versão comercial, registros de entrega e recibos de operação.

Publique Billing, Control API e API antes dos formulários. Não há necessidade de modificar Licensing. Contratos antigos sem `overage` permanecem válidos e não autorizam excedentes até uma nova versão configurar as tarifas. Não há retomada da integração Stripe antiga na API.

## Verificação

Os testes `test/integration/cloud-usage.cjs` de Billing e API exigem banco vazio local cujo nome termine em `_billing_test`. Eles recusam hosts externos e schema existente. Testam concorrência, idempotência, mudança de preço, proteção de Free/cortesia, rollback, fechamento e registros tardios sem executar pagamentos externos.
