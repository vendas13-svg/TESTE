const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Garantir que a pasta de logs existe
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    // Console com cores
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      )
    }),
    // Arquivo de log geral
    new winston.transports.File({
      filename: path.join(logsDir, 'agent.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 7,
      tailable: true
    }),
    // Arquivo separado só para mensagens importantes
    new winston.transports.File({
      filename: path.join(logsDir, 'important.log'),
      level: 'warn',
      maxsize: 2 * 1024 * 1024,
      maxFiles: 30
    })
  ]
});

function logMessage(message, classification) {
  const sender = message.from.replace('@c.us', '').replace('@g.us', '');
  const body = message.body.substring(0, 100);
  const prefix = classification.isGroup ? '[GRUPO]' : '[PRIVADO]';
  const urgency = classification.isUrgent ? ' [URGENTE!]' : '';
  const vip = classification.isVip ? ' [VIP]' : '';

  const logEntry = `${prefix}${urgency}${vip} De: ${sender} | Msg: ${body}`;

  if (classification.priority === 'critical' || classification.priority === 'high') {
    logger.warn(logEntry);
  } else {
    logger.info(logEntry);
  }
}

function logAutoReply(to, reply) {
  const contact = to.replace('@c.us', '');
  logger.info(`[AUTO-REPLY] Para: ${contact} | Resposta: ${reply.substring(0, 80)}`);
}

function logSystem(message, level = 'info') {
  logger[level](`[SISTEMA] ${message}`);
}

module.exports = { logger, logMessage, logAutoReply, logSystem };
