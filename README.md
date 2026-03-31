# WhatsApp AI Agent

Agente de IA para WhatsApp que **monitora todas as mensagens** e **responde perguntas simples** automaticamente usando Claude (Anthropic).

## Funcionalidades

- **Monitoramento em tempo real** de todas as mensagens recebidas
- **Detecção automática de urgência** (palavras-chave: urgente, socorro, pix, reunião, etc.)
- **Contatos VIP** com prioridade máxima
- **Resposta automática** com IA para perguntas simples (opcional)
- **Resumo periódico** das mensagens enviado para você
- **Log completo** de todas as mensagens em arquivo
- **Comandos via WhatsApp** para controlar o agente

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com suas configurações

# 3. Iniciar o agente
npm start
```

Na primeira execução, um QR Code aparecerá no terminal. Escaneie com o WhatsApp (Dispositivos vinculados > Vincular dispositivo).

## Comandos via WhatsApp

Envie para si mesmo (do seu próprio número):

| Comando | Descrição |
|---------|-----------|
| `!resumo` | Resumo com IA de todas as mensagens no buffer |
| `!urgentes` | Lista apenas mensagens urgentes |
| `!status` | Status atual do agente |
| `!ajuda` | Lista de comandos |

## Configuração (.env)

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `ANTHROPIC_API_KEY` | Chave da API Claude | obrigatório |
| `OWNER_NUMBER` | Seu número (DDI+DDD+número) | obrigatório para resumos |
| `AUTO_REPLY` | Responder perguntas automaticamente | `false` |
| `VIP_CONTACTS` | Números com prioridade alta (separados por vírgula) | vazio |
| `SUMMARY_INTERVAL_HOURS` | Intervalo do resumo automático em horas | `6` |

## Estrutura

```
├── index.js              # Entrada principal do agente
├── src/
│   ├── claude.js         # Integração com Claude AI
│   ├── monitor.js        # Classificação e detecção de urgência
│   └── logger.js         # Sistema de logs
├── logs/                 # Logs gerados (gitignored)
└── .wwebjs_auth/         # Sessão WhatsApp salva (gitignored)
```
