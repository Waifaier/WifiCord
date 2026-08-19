const db = require('../server/database/db');
const User = require('../server/models/User');

function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME?.trim();

  if (!username) {
    console.log('[ADMIN] ADMIN_USERNAME não configurado. Pulando ativação.');
    return;
  }

  const existingAdmin = db
    .prepare("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1")
    .get();

  if (existingAdmin) {
    console.log(`[ADMIN] Já existe um administrador: ${existingAdmin.username}`);
    return;
  }

  const user = User.findByUsername(username);

  if (!user) {
    console.log(`[ADMIN] Usuário "${username}" ainda não existe.`);
    return;
  }

  User.setRole(user.id, 'admin');

  console.log(`[ADMIN] Administrador ativado: ${user.username}`);
}

module.exports = bootstrapAdmin;