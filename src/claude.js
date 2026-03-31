const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um assistente de WhatsApp inteligente e prestativo chamado "Assistente".
Seu objetivo é:
1. Responder perguntas simples de forma direta e concisa
2. Ser educado e natural, como uma pessoa real
3. Se não souber algo, dizer claramente
4. Responder SEMPRE em português (pt-BR)
5. Manter respostas curtas (máximo 3 frases) para conversas de WhatsApp
6. NÃO se apresentar como IA a menos que perguntado diretamente

Se a pergunta for muito complexa ou pessoal demais, diga que o dono do número está ocupado e retornará em breve.`;

async function askClaude(userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages
  });

  return response.content[0].text;
}

async function summarizeMessages(messages) {
  const messagesList = messages
    .map((m) => `[${m.time}] ${m.from}: ${m.body}`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Faça um resumo conciso das seguintes mensagens do WhatsApp que eu perdi, destacando as mais importantes e urgentes:\n\n${messagesList}\n\nResumo:`
      }
    ]
  });

  return response.content[0].text;
}

module.exports = { askClaude, summarizeMessages };
