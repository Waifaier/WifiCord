#!/usr/bin/env node
// Uso: node scripts/admin-role.js <username> <admin|user>
// Exemplos:
//   node scripts/admin-role.js davi admin
//   node scripts/admin-role.js davi user
const db=require('../server/database/db');
const User=require('../server/models/User');
const [username,role='user']=process.argv.slice(2);
if(!username||!['admin','user'].includes(role)){
  console.error('Uso: node scripts/admin-role.js <username> <admin|user>');
  process.exit(1);
}
const row=db.prepare('SELECT id,username,role FROM users WHERE username=? COLLATE NOCASE').get(username);
if(!row){console.error(`Usuário não encontrado: ${username}`);process.exit(2);}
if(role==='user'&&row.role==='admin'){
  const count=db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n;
  if(Number(count)<=1){console.error('Não é possível remover o último administrador. Promova outro primeiro.');process.exit(3);}
}
const updated=User.setRole(row.id,role);
console.log(`${updated.username}: ${row.role} -> ${role}`);
