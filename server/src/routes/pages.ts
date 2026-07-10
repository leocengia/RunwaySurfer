// Route delle pagine HTML: login, cambio password e dashboard.
import { Router } from 'express';
import { authenticate, requirePage, type AuthContext } from '../auth.js';
import { renderLoginPage, renderChangePasswordPage } from '../views/auth-pages.js';
import { renderDashboard } from '../views/dashboard.js';

export const pageRoutes = Router();

pageRoutes.get('/login', (req, res) => {
  // Already authenticated? Straight to the right page.
  const auth = authenticate(req);
  if (auth) {
    res.redirect(auth.user.must_change_password ? '/change-password' : '/dashboard');
    return;
  }
  res.type('html').send(renderLoginPage());
});

pageRoutes.get('/change-password', (req, res) => {
  const auth = authenticate(req);
  if (!auth) {
    res.redirect('/login');
    return;
  }
  res.type('html').send(renderChangePasswordPage(!!auth.user.must_change_password));
});

pageRoutes.get('/dashboard', requirePage('team_lead'), (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  res.type('html').send(renderDashboard(auth));
});
