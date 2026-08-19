// client/js/auth.js
// Login, cadastro, logout e verificação de sessão. Não usa localStorage.

(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  async function api(url, options) {
    options = options || {};
    const opts = Object.assign(
      { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } },
      options
    );

    let res;
    try {
      res = await fetch(url, opts);
    } catch (networkErr) {
      throw new Error('Falha de conexão. Verifique sua internet.');
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = null;
      }
    }

    if (!res.ok) {
      throw new Error((data && data.error) || 'Erro na requisição (' + res.status + ')');
    }
    return data;
  }

  function toast(message, type) {
    if (window.App && window.App.toast) {
      window.App.toast(message, type);
      return;
    }
    // Fallback simples caso app.js ainda não tenha carregado.
    console[type === 'error' ? 'error' : 'log'](message);
  }

  const authScreen = $('auth-screen');
  const appScreen = $('app-screen');
  const loginForm = $('login-form');
  const registerForm = $('register-form');
  const tabs = document.querySelectorAll('.auth-tab');

  function showApp(user) {
    if (authScreen) authScreen.classList.add('hidden');
    if (appScreen) appScreen.classList.remove('hidden');
    if (window.App) window.App.init(user);
  }

  function showAuth() {
    if (appScreen) appScreen.classList.add('hidden');
    if (authScreen) authScreen.classList.remove('hidden');
  }

  function bindTabs() {
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          t.classList.remove('active');
        });
        tab.classList.add('active');
        const target = tab.getAttribute('data-tab');
        if (loginForm) loginForm.classList.toggle('hidden', target !== 'login');
        if (registerForm) registerForm.classList.toggle('hidden', target !== 'register');
      });
    });
  }

  function bindLogin() {
    if (!loginForm) return;
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = loginForm.email.value.trim();
      const password = loginForm.password.value;
      const submitBtn = loginForm.querySelector('button[type="submit"]');

      submitBtn.disabled = true;
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: email, password: password }),
        });
        showApp(data.user);
      } catch (err) {
        toast(err.message || 'Erro ao entrar.', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function bindRegister() {
    if (!registerForm) return;
    registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const username = registerForm.username.value.trim();
      const displayName = registerForm.displayName.value.trim();
      const email = registerForm.email.value.trim();
      const password = registerForm.password.value;
      const submitBtn = registerForm.querySelector('button[type="submit"]');

      submitBtn.disabled = true;
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username: username, displayName: displayName, email: email, password: password }),
        });
        showApp(data.user);
      } catch (err) {
        toast(err.message || 'Erro ao criar conta.', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      // segue mesmo se der erro, a sessão será limpa de qualquer forma
    }
    if (window.ChatSocket) window.ChatSocket.disconnect();
    showAuth();
    window.location.reload();
  }

  async function checkSession() {
    try {
      const data = await api('/api/auth/me');
      showApp(data.user);
    } catch (err) {
      showAuth();
    }
  }

  bindTabs();
  bindLogin();
  bindRegister();
  checkSession();

  window.Auth = { logout: logout };
})();
