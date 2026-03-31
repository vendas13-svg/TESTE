// Palavras-chave que indicam mensagem URGENTE/IMPORTANTE
const URGENT_KEYWORDS = [
  'urgente', 'urgent', 'emergência', 'emergencia', 'socorro',
  'ajuda', 'help', 'sos', 'importante', 'critical', 'critico', 'crítico',
  'preciso de você', 'preciso de vc', 'me liga', 'me ligue', 'ligar',
  'hospital', 'acidente', 'morte', 'morreu', 'faleceu',
  'dinheiro', 'pagar', 'pagamento', 'transferência', 'transferencia', 'pix',
  'contrato', 'prazo', 'deadline', 'vencimento', 'reunião', 'reuniao',
  'entrevista', 'resultado', 'aprovado', 'reprovado'
];

// Palavras que indicam PERGUNTA simples (bot deve responder)
const QUESTION_INDICATORS = [
  '?', 'qual', 'quando', 'como', 'onde', 'quem', 'por que', 'porque',
  'o que', 'me diz', 'me fala', 'sabe', 'você sabe', 'vc sabe',
  'tem como', 'pode me', 'pode falar', 'que horas', 'que dia'
];

// Contatos VIP (números que sempre têm prioridade)
const VIP_CONTACTS = (process.env.VIP_CONTACTS || '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

function isUrgent(message) {
  const text = message.body.toLowerCase();
  return URGENT_KEYWORDS.some((kw) => text.includes(kw));
}

function isSimpleQuestion(message) {
  const text = message.body.toLowerCase();
  return QUESTION_INDICATORS.some((indicator) => text.includes(indicator));
}

function isVipContact(message) {
  const sender = message.from.replace('@c.us', '').replace('@g.us', '');
  return VIP_CONTACTS.some((vip) => sender.includes(vip.replace(/\D/g, '')));
}

function isGroupMessage(message) {
  return message.from.endsWith('@g.us');
}

function classifyMessage(message) {
  const urgent = isUrgent(message);
  const vip = isVipContact(message);
  const question = isSimpleQuestion(message);
  const group = isGroupMessage(message);

  let priority = 'normal';
  if (urgent || vip) priority = 'high';
  if (urgent && vip) priority = 'critical';

  return {
    priority,
    isUrgent: urgent,
    isVip: vip,
    isQuestion: question,
    isGroup: group,
    shouldAutoReply: question && !group && process.env.AUTO_REPLY === 'true'
  };
}

// Buffer de mensagens perdidas (quando agente está "ausente")
class MissedMessageBuffer {
  constructor() {
    this.messages = [];
    this.isActive = true;
  }

  add(message, classification) {
    this.messages.push({
      from: message.from,
      body: message.body,
      time: new Date().toLocaleTimeString('pt-BR'),
      date: new Date().toLocaleDateString('pt-BR'),
      priority: classification.priority,
      isUrgent: classification.isUrgent
    });
  }

  getAll() {
    return [...this.messages];
  }

  getUrgent() {
    return this.messages.filter((m) => m.isUrgent || m.priority === 'critical');
  }

  clear() {
    this.messages = [];
  }

  count() {
    return this.messages.length;
  }
}

module.exports = { classifyMessage, MissedMessageBuffer, isUrgent, isSimpleQuestion };
