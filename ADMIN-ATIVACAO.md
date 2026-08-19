# Ativação do administrador

A ativação inicial continua sendo controlada pelo servidor. Nenhum usuário consegue se promover pelo navegador.

## Render

Configure a Environment Variable:

```text
ADMIN_USERNAME=waifaier
```

Depois:

1. Faça o deploy.
2. Se `waifaier` ainda não existir, o log mostrará que o usuário ainda não existe.
3. Crie normalmente a conta `waifaier`.
4. Faça um novo **Restart** ou **Deploy** do serviço.
5. O bootstrap encontrará a conta e a promoverá automaticamente.
6. O próximo restart não criará outro administrador, porque já haverá um admin.

Se já existir qualquer administrador, `ADMIN_USERNAME` não promove automaticamente outra conta.

## Local

Depois de criar uma conta:

```bash
npm run admin:setup -- SEU_USUARIO
```

O comando só funciona enquanto não houver administrador.

## Segurança

`ADMIN_USERNAME` é lido exclusivamente de `process.env` no servidor. Alterações feitas pelo navegador não podem alterar Environment Variables do Render.

O segredo da sessão (`SESSION_SECRET`) também deve existir somente nas Environment Variables do ambiente de produção.
