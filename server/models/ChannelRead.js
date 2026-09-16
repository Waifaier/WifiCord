// Até onde cada pessoa já leu cada canal — usado pra calcular indicador de
// não lida/menção nos servidores de um jeito que sobrevive a reconexão e
// F5 (ver server/models/Message.js, getUnreadSummaryForUser).
const db = require('../database/db');

const ChannelRead = {
  // Marca como lido até a mensagem `lastMessageId` (nunca volta pra trás:
  // se a pessoa já tinha lido até uma mensagem mais nova por algum outro
  // caminho, mantém a mais nova).
  markRead(userId, channelId, lastMessageId) {
    if (!userId || !channelId || !lastMessageId) return;
    db.prepare(
      `INSERT INTO channel_reads (user_id, channel_id, last_read_message_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, channel_id) DO UPDATE SET
         last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id),
         updated_at = excluded.updated_at`
    ).run(userId, channelId, lastMessageId);
  },
};

module.exports = ChannelRead;
