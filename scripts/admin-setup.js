#!/usr/bin/env node
const db=require('../server/database/db');
const User=require('../server/models/User');
const username=process.argv[2];
if(!username){console.error('Uso: npm run admin:setup -- <username>');process.exit(1)}
const admins=db.prepare("SELECT id,username FROM users WHERE role='admin'").all();
if(admins.length){console.error('Já existe um administrador:',admins.map(x=>x.username).join(', '));process.exit(1)}
const user=User.findByUsername(username);
if(!user){console.error('Usuário não encontrado:',username);process.exit(1)}
User.setRole(user.id,'admin');
console.log(`Administrador ativado: ${user.username} (id ${user.id})`);
