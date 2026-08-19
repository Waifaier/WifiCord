const db = require('../server/database/db');
const User = require('../server/models/User');

function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME?.trim();

  if (!username) {
    console.log('[ADMIN] ADMIN_USERNAME não configurado. Pulando ativação.');
    return;
  }

  const existingAdmin = db
    .prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
    .get();

  if (existingAdmin) {
    console.log(`[ADMIN] Já existe um administrador: ${existingAdmin.username}. Nenhuma promoção automática foi feita.`);
    return;
  }

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1')
    .get(username);

  if (!user) {
    console.log(`[ADMIN] Usuário "${username}" ainda não existe. Crie essa conta e reinicie/deploy o servidor para ativá-la.`);
    return;
  }

  User.setRole(user.id, 'admin');

  console.log(`[ADMIN] Administrador ativado automaticamente: ${user.username} (id ${user.id}).`);
}

module.exports = bootstrapAdmin;
