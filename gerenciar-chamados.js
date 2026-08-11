'use strict';

const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const {
  DB_PATH,
  EXCEL_PATH,
  initDatabase,
  closeDatabase,
  findTicket,
  listTickets,
  countTickets,
  getStatistics,
  updateTicketStatus,
  retryClosureNotification,
  exportTicketsToJson,
  exportTicketsToExcel,
  waitForExcelExport,
} = require('./database');

const VALID_STATUSES = [
  'Recebido',
  'Em análise',
  'Aguardando informações',
  'Em atendimento',
  'Aguardando fornecedor',
  'Encerrado',
  'Cancelado',
];

function formatDate(value) {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: process.env.TIMEZONE || 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function priorityIcon(priority) {
  return {
    Crítica: '🔴',
    Alta: '🟠',
    Média: '🟡',
    Baixa: '🟢',
  }[priority] || '⚪';
}

function printTicket(ticket) {
  console.log('\n=============================================================');
  console.log(`${priorityIcon(ticket.prioridade)} ${ticket.prioridade.toUpperCase()} — ${ticket.protocolo}`);
  console.log('=============================================================');
  console.log(`Data: ${ticket.dataHoraFormatada || formatDate(ticket.dataHora)}`);
  console.log(`Nome: ${ticket.nome}`);
  console.log(`WhatsApp: ${ticket.numeroWhatsApp}`);
  console.log(`Setor: ${ticket.setor}`);
  console.log(`Local: ${ticket.local}`);
  console.log(`Categoria: ${ticket.categoria}`);
  console.log(`Urgência: ${ticket.prioridade}`);
  console.log(`Impacto: ${ticket.nivelImpacto}`);
  console.log(`Status: ${ticket.status}`);
  console.log(`Descrição: ${ticket.descricaoInicial}`);
  console.log(`Última atualização: ${formatDate(ticket.ultimaAtualizacao)}`);

  if (ticket.respostas?.length) {
    console.log('\nRESPOSTAS');
    ticket.respostas.forEach((item, index) => {
      console.log(`${index + 1}. ${item.pergunta}`);
      console.log(`   ${item.resposta}`);
    });
  }
}

function printTicketList(tickets, title) {
  console.log(`\n${title}`);
  console.log('=============================================================');
  if (!tickets.length) {
    console.log('Nenhum chamado encontrado.');
    return;
  }

  tickets.forEach((ticket) => {
    console.log(
      `${priorityIcon(ticket.prioridade)} ${ticket.prioridade.padEnd(7)} | ${ticket.protocolo} | ${ticket.status} | ${ticket.categoria} | ${ticket.nome}`,
    );
  });
}

async function consultTicket(rl) {
  const protocol = (await rl.question('\nDigite o protocolo: ')).trim().toUpperCase();
  const ticket = findTicket(protocol);
  if (!ticket) {
    console.log('Protocolo não encontrado.');
    return;
  }
  printTicket(ticket);
}

async function changeStatus(rl) {
  const protocol = (await rl.question('\nDigite o protocolo: ')).trim().toUpperCase();
  const ticket = findTicket(protocol);
  if (!ticket) {
    console.log('Protocolo não encontrado.');
    return;
  }

  printTicket(ticket);
  console.log('\nEscolha o novo status:');
  VALID_STATUSES.forEach((status, index) => console.log(`${index + 1}. ${status}`));
  const option = Number(await rl.question('\nNúmero do novo status: '));
  const newStatus = VALID_STATUSES[option - 1];
  if (!newStatus) {
    console.log('Opção inválida.');
    return;
  }

  const observation = (await rl.question('Observação (opcional): ')).trim();
  const updated = updateTicketStatus(protocol, newStatus, observation, { origin: 'Gerenciador local', notify: true });
  if (updated) {
    await waitForExcelExport();
    console.log(`Status alterado para “${newStatus}”.`);
    console.log(`Planilha atualizada: ${EXCEL_PATH}`);
    if (newStatus === 'Encerrado') {
      console.log('A mensagem de encerramento foi adicionada à fila do WhatsApp.');
      console.log('O bot precisa estar em execução para realizar o envio.');
    }
  } else {
    console.log('Não foi possível atualizar.');
  }
}

async function retryNotification(rl) {
  const protocol = (await rl.question('\nDigite o protocolo encerrado: ')).trim().toUpperCase();
  const ticket = findTicket(protocol);
  if (!ticket) {
    console.log('Protocolo não encontrado.');
    return;
  }
  if (ticket.status !== 'Encerrado') {
    console.log('O chamado ainda não está com o status Encerrado.');
    return;
  }
  if (ticket.encerramentoNotificado) {
    console.log('A mensagem de encerramento já foi enviada ao usuário.');
    return;
  }
  if (retryClosureNotification(protocol)) {
    console.log('Notificação recolocada na fila. Mantenha o bot em execução.');
  } else {
    console.log('Não existe uma notificação pendente para este protocolo.');
  }
}

function printStatistics() {
  const stats = getStatistics();
  console.log('\nESTATÍSTICAS');
  console.log('=============================================================');
  console.log(`Total de chamados: ${stats.total}`);
  console.log('\nPor urgência:');
  stats.byPriority.forEach((item) => {
    console.log(`${priorityIcon(item.prioridade)} ${item.prioridade}: ${item.total}`);
  });
  console.log('\nPor status:');
  stats.byStatus.forEach((item) => console.log(`• ${item.status}: ${item.total}`));
}

async function main() {
  initDatabase();
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      console.clear();
      console.log('=============================================================');
      console.log(' GERENCIADOR DE CHAMADOS — SUPORTE TI');
      console.log('=============================================================');
      console.log(`Banco: ${DB_PATH}`);
      console.log(`Excel: ${EXCEL_PATH}`);
      console.log(`Total de chamados: ${countTickets()}`);
      console.log('\n1. Listar por urgência (críticos primeiro)');
      console.log('2. Listar os mais recentes');
      console.log('3. Consultar chamado completo');
      console.log('4. Atualizar status');
      console.log('5. Ver estatísticas');
      console.log('6. Sincronizar a planilha Excel agora');
      console.log('7. Tentar novamente uma notificação de encerramento');
      console.log('8. Exportar cópia em JSON');
      console.log('9. Sair');

      const option = (await rl.question('\nEscolha uma opção: ')).trim();

      if (option === '1') {
        printTicketList(listTickets({ limit: 100, orderByUrgency: true }), 'CHAMADOS POR URGÊNCIA');
      } else if (option === '2') {
        printTicketList(listTickets({ limit: 100, orderByUrgency: false }), 'CHAMADOS MAIS RECENTES');
      } else if (option === '3') {
        await consultTicket(rl);
      } else if (option === '4') {
        await changeStatus(rl);
      } else if (option === '5') {
        printStatistics();
      } else if (option === '6') {
        await exportTicketsToExcel();
        console.log(`\nPlanilha sincronizada em ${EXCEL_PATH}.`);
      } else if (option === '7') {
        await retryNotification(rl);
      } else if (option === '8') {
        exportTicketsToJson();
        console.log('\nCópia atualizada em data\\chamados.json.');
      } else if (option === '9') {
        break;
      } else {
        console.log('\nOpção inválida.');
      }

      if (option !== '9') await rl.question('\nPressione ENTER para continuar...');
    }
  } catch (error) {
    console.error('\nErro no gerenciador:', error);
  } finally {
    await waitForExcelExport();
    rl.close();
    closeDatabase();
  }
}

main();
