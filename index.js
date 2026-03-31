require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { askClaude, summarizeMessages } = require('./src/claude');
const { classifyMessage, MissedMessageBuffer } = require('./src/monitor');
const { logMessage, logAutoReply, logSystem, logger } = require('./src/logger');

// ─── Configurações ───────────────────────────────────────────────────────────
const AUTO_REPLY = process.env.AUTO_REPLY === 'true';
const OWNER_NUMBER = process.env.OWNER_NUMBER || ''; // ex: 5511999999999
const SUMMARY_INTERVAL_HOURS = parseInt(process.env.SUMMARY_INTERVAL_HOURS || '6', 10);

// Histórico de conversa por contato (máx. 10 trocas)
const conversationHistory = new Map();
const missedBuffer = new MissedMessageBuffer();

// ─── Cliente WhatsApp ─────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  }
});

// ─── Eventos do cliente ───────────────────────────────────────────────────────

client.on('qr', (qr) => {
  logSystem('Escaneie o QR Code abaixo com o WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  logSystem('Autenticado com sucesso!');
});

client.on('auth_failure', (msg) => {
  logSystem(`Falha na autenticação: ${msg}`, 'error');
  process.exit(1);
});

client.on('ready', () => {
  logSystem('Agente WhatsApp ONLINE e monitorando mensagens!');
  logSystem(`Resposta automática: ${AUTO_REPLY ? 'ATIVADA' : 'DESATIVADA'}`);
  logSystem(`Resumo periódico: a cada ${SUMMARY_INTERVAL_HOURS}h`);

  // Inicia o resumo periódico de mensagens perdidas
  if (OWNER_NUMBER) {
    startPeriodicSummary();
  }
});

client.on('disconnected', (reason) => {
  logSystem(`Desconectado: ${reason}`, 'warn');
  setTimeout(() => {
    logSystem('Tentando reconectar...');
    client.initialize();
  }, 5000);
});

// ─── Processamento de mensagens ───────────────────────────────────────────────

client.on('message', async (message) => {
  try {
    // Ignora mensagens próprias e de status
    if (message.fromMe || message.isStatus) return;

    const classification = classifyMessage(message);
    logMessage(message, classification);

    // Adiciona ao buffer de mensagens perdidas
    missedBuffer.add(message, classification);

    // Alerta imediato no console para mensagens urgentes
    if (classification.isUrgent || classification.priority === 'critical') {
      const sender = message.from.replace('@c.us', '');
      logger.warn(`\n🚨 MENSAGEM URGENTE de ${sender}: "${message.body}"\n`);
    }

    // Auto-resposta com IA para perguntas simples
    if (AUTO_REPLY && classification.shouldAutoReply) {
      await handleAutoReply(message);
    }
  } catch (err) {
    logSystem(`Erro ao processar mensagem: ${err.message}`, 'error');
  }
});

// ─── Auto-resposta inteligente ────────────────────────────────────────────────

async function handleAutoReply(message) {
  const contactId = message.from;

  // Recupera histórico da conversa (últimas 10 mensagens)
  if (!conversationHistory.has(contactId)) {
    conversationHistory.set(contactId, []);
  }
  const history = conversationHistory.get(contactId);

  try {
    const reply = await askClaude(message.body, history);

    // Atualiza histórico (mantém máx. 10 pares)
    history.push({ role: 'user', content: message.body });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 20) history.splice(0, 2);

    await message.reply(reply);
    logAutoReply(message.from, reply);
  } catch (err) {
    logSystem(`Erro na auto-resposta: ${err.message}`, 'error');
  }
}

// ─── Resumo periódico ─────────────────────────────────────────────────────────

function startPeriodicSummary() {
  const intervalMs = SUMMARY_INTERVAL_HOURS * 60 * 60 * 1000;

  setInterval(async () => {
    const messages = missedBuffer.getAll();
    if (messages.length === 0) return;

    try {
      logSystem(`Gerando resumo de ${messages.length} mensagens...`);
      const summary = await summarizeMessages(messages);
      const ownerJid = `${OWNER_NUMBER.replace(/\D/g, '')}@c.us`;

      const fullSummary =
        `📋 *RESUMO DO AGENTE - ${new Date().toLocaleString('pt-BR')}*\n\n` +
        `📩 Total de mensagens: ${messages.length}\n` +
        `🚨 Urgentes: ${missedBuffer.getUrgent().length}\n\n` +
        `${summary}`;

      await client.sendMessage(ownerJid, fullSummary);
      logSystem('Resumo enviado para o dono.');
      missedBuffer.clear();
    } catch (err) {
      logSystem(`Erro ao enviar resumo: ${err.message}`, 'error');
    }
  }, intervalMs);
}

// ─── Comandos do dono via WhatsApp ────────────────────────────────────────────

client.on('message', async (message) => {
  if (!message.fromMe) return;

  const body = message.body.trim().toLowerCase();

  if (body === '!resumo') {
    const messages = missedBuffer.getAll();
    if (messages.length === 0) {
      await message.reply('Nenhuma mensagem nova desde o último resumo.');
      return;
    }
    const summary = await summarizeMessages(messages);
    await message.reply(
      `📋 *${messages.length} mensagens:*\n\n${summary}`
    );
    missedBuffer.clear();
  }

  if (body === '!urgentes') {
    const urgent = missedBuffer.getUrgent();
    if (urgent.length === 0) {
      await message.reply('Nenhuma mensagem urgente.');
    } else {
      const list = urgent
        .map((m) => `• [${m.time}] ${m.from.replace('@c.us', '')}: ${m.body}`)
        .join('\n');
      await message.reply(`🚨 *${urgent.length} urgentes:*\n\n${list}`);
    }
  }

  if (body === '!status') {
    const total = missedBuffer.count();
    const urgent = missedBuffer.getUrgent().length;
    await message.reply(
      `✅ *Agente ativo*\n` +
      `📩 Msgs no buffer: ${total}\n` +
      `🚨 Urgentes: ${urgent}\n` +
      `🤖 Auto-reply: ${AUTO_REPLY ? 'ON' : 'OFF'}`
    );
  }

  if (body === '!ajuda') {
    await message.reply(
      `*Comandos disponíveis:*\n` +
      `!resumo — Resumo de todas as mensagens\n` +
      `!urgentes — Ver mensagens urgentes\n` +
      `!status — Status do agente\n` +
      `!ajuda — Esta mensagem`
    );
  }
});

// ─── Inicialização ────────────────────────────────────────────────────────────

logSystem('Iniciando agente WhatsApp...');
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
  logSystem('Encerrando agente...');
  await client.destroy();
  process.exit(0);
});
