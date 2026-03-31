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

    // Ignora grupos no painel (não loga nem adiciona ao buffer)
    if (classification.isGroup) return;

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
// Usa message_create para capturar mensagens enviadas pelo próprio dono

client.on('message_create', async (message) => {
  if (!message.fromMe) return;

  const body = message.body.trim().toLowerCase();

  if (body === '!resumo') {
    try {
      const messages = missedBuffer.getAll();
      if (messages.length === 0) {
        await client.sendMessage(message.to, 'Nenhuma mensagem nova desde o último resumo.');
        return;
      }
      const summary = await summarizeMessages(messages);
      await client.sendMessage(message.to,
        `📋 *${messages.length} mensagens:*\n\n${summary}`
      );
      missedBuffer.clear();
    } catch (err) {
      logSystem(`Erro no !resumo: ${err.message}`, 'error');
    }
  }

  if (body === '!urgentes') {
    try {
      const urgent = missedBuffer.getUrgent();
      if (urgent.length === 0) {
        await client.sendMessage(message.to, 'Nenhuma mensagem urgente.');
      } else {
        const list = urgent
          .map((m) => `• [${m.time}] ${m.from.replace('@c.us', '')}: ${m.body}`)
          .join('\n');
        await client.sendMessage(message.to, `🚨 *${urgent.length} urgentes:*\n\n${list}`);
      }
    } catch (err) {
      logSystem(`Erro no !urgentes: ${err.message}`, 'error');
    }
  }

  if (body === '!status') {
    try {
      const total = missedBuffer.count();
      const urgent = missedBuffer.getUrgent().length;
      await client.sendMessage(message.to,
        `✅ *Agente ativo*\n` +
        `📩 Msgs no buffer: ${total}\n` +
        `🚨 Urgentes: ${urgent}\n` +
        `🤖 Auto-reply: ${AUTO_REPLY ? 'ON' : 'OFF'}`
      );
    } catch (err) {
      logSystem(`Erro no !status: ${err.message}`, 'error');
    }
  }

  if (body === '!pendencias') {
    try {
      await client.sendMessage(message.to, '🔍 Analisando seus últimos 10 contatos, aguarde...');
      const chats = await client.getChats();

      // Pega os 10 chats mais recentes (exclui grupos e status)
      const recentChats = chats
        .filter((c) => !c.isGroup && c.name !== 'Status')
        .slice(0, 10);

      const chatSummaries = [];

      for (const chat of recentChats) {
        const msgs = await chat.fetchMessages({ limit: 10 });
        if (msgs.length === 0) continue;

        const lines = msgs.map((m) => {
          const who = m.fromMe ? 'Você' : chat.name;
          return `${who}: ${m.body}`;
        }).join('\n');

        chatSummaries.push({ name: chat.name, messages: lines, unread: chat.unreadCount });
      }

      const { analyzePendingChats } = require('./src/claude');
      const analysis = await analyzePendingChats(chatSummaries);

      await client.sendMessage(message.to, `📊 *PENDÊNCIAS - últimos 10 contatos:*\n\n${analysis}`);
    } catch (err) {
      logSystem(`Erro no !pendencias: ${err.message}`, 'error');
      await client.sendMessage(message.to, 'Erro ao analisar pendências. Tente novamente.');
    }
  }

  if (body === '!ajuda') {
    try {
      await client.sendMessage(message.to,
        `*Comandos disponíveis:*\n` +
        `!resumo — Resumo das mensagens recebidas\n` +
        `!urgentes — Ver mensagens urgentes\n` +
        `!pendencias — Analisa os 10 últimos contatos por pendências de trabalho\n` +
        `!status — Status do agente\n` +
        `!ajuda — Esta mensagem`
      );
    } catch (err) {
      logSystem(`Erro no !ajuda: ${err.message}`, 'error');
    }
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
