export function financialNotice(
  state: string,
  portalUrl: string,
  restrictAt: string | null,
  suspendAt: string | null,
) {
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'America/Recife',
        }).format(new Date(value)) + ' (Recife)'
      : '-';
  const messages: Record<string, [string, string]> = {
    healthy: [
      'Acesso regularizado',
      'Os saldos vencidos foram regularizados. O uso foi liberado conforme seu contrato.',
    ],
    payment_attention: [
      'Pagamento em atraso',
      `Identificamos saldo vencido. Regularize suas faturas para evitar restrições.
Restrição prevista: ${date(restrictAt)}.
Suspensão prevista: ${date(suspendAt)}.`,
    ],
    payment_restricted: [
      'Uso restrito por inadimplência',
      `As alterações do workspace, IA e replay estão restritos. A ingestão permanece disponível nesta etapa.
Suspensão prevista: ${date(suspendAt)}.`,
    ],
    payment_suspended: [
      'Uso suspenso por inadimplência',
      'As operações de uso, incluindo ingestão, estão suspensas até a regularização.',
    ],
  };
  const message = messages[state];
  if (!message) throw new Error('Invalid financial notice state');
  return {
    subject: `Rebound DLQ: ${message[0]}`,
    text: `${message[1]}

Seu usuário e seus dados foram preservados. Login, consulta e regularização permanecem disponíveis.

Faturas e pagamentos: ${portalUrl}

Boleto em processamento ou pagamento parcial não confirma a quitação de todos os saldos vencidos. No self-hosted, a recuperação requer sincronização da licença.

Atendimento: contato@rebound-dlq.com`,
  };
}
