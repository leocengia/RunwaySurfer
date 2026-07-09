import { describe, expect, it } from 'vitest';
import type express from 'express';
import {
  clearLoginFailures,
  extractToken,
  hashPassword,
  isLoginBlocked,
  parseCookies,
  recordLoginFailure,
  validateNewPassword,
  verifyPassword,
} from '../src/auth.js';

describe('hashPassword / verifyPassword', () => {
  it('verifica la password corretta e rifiuta quella sbagliata', async () => {
    const hash = await hashPassword('password-super-segreta');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('password-super-segreta', hash)).toBe(true);
    expect(await verifyPassword('password-sbagliata', hash)).toBe(false);
  });

  it('produce hash diversi per la stessa password (salt casuale)', async () => {
    const a = await hashPassword('stessa-password');
    const b = await hashPassword('stessa-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('stessa-password', a)).toBe(true);
    expect(await verifyPassword('stessa-password', b)).toBe(true);
  });

  it('rifiuta hash mancanti o malformati senza lanciare eccezioni', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'non-un-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$N=1$troppo$corto$extra')).toBe(false);
  });
});

describe('validateNewPassword', () => {
  it('richiede almeno 8 caratteri', () => {
    expect(validateNewPassword('corta')).toContain('8');
    expect(validateNewPassword('lunga-abbastanza')).toBeNull();
  });

  it('rifiuta non-stringhe e password esagerate', () => {
    expect(validateNewPassword(12345678)).not.toBeNull();
    expect(validateNewPassword(undefined)).not.toBeNull();
    expect(validateNewPassword('x'.repeat(201))).toBe('password troppo lunga');
  });
});

describe('parseCookies', () => {
  it('estrae le coppie nome=valore', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('gestisce header assente, segmenti senza = e valori url-encoded', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('senzauguale; ok=s%C3%AC')).toEqual({ ok: 'sì' });
  });
});

function fakeReq(headers: { authorization?: string; cookie?: string }): express.Request {
  return {
    get: (name: string) =>
      name.toLowerCase() === 'authorization' ? headers.authorization : undefined,
    headers: { cookie: headers.cookie },
    ip: '10.0.0.1',
  } as unknown as express.Request;
}

describe('extractToken', () => {
  it('preferisce il bearer token al cookie', () => {
    const req = fakeReq({ authorization: 'Bearer tok123', cookie: 'rs_session=cook456' });
    expect(extractToken(req)).toEqual({ token: 'tok123', via: 'bearer' });
  });

  it('usa il cookie di sessione come fallback', () => {
    const req = fakeReq({ cookie: 'rs_session=cook456' });
    expect(extractToken(req)).toEqual({ token: 'cook456', via: 'cookie' });
  });

  it('restituisce null senza credenziali', () => {
    expect(extractToken(fakeReq({}))).toBeNull();
  });
});

describe('rate limiting login', () => {
  it('blocca dopo 5 tentativi falliti e si azzera con clearLoginFailures', () => {
    const req = fakeReq({});
    const username = `utente-${Date.now()}`;
    expect(isLoginBlocked(req, username)).toBe(false);
    for (let i = 0; i < 5; i++) recordLoginFailure(req, username);
    expect(isLoginBlocked(req, username)).toBe(true);
    clearLoginFailures(req, username);
    expect(isLoginBlocked(req, username)).toBe(false);
  });

  it('il contatore è per coppia ip|username', () => {
    const req = fakeReq({});
    const bloccato = `bloccato-${Date.now()}`;
    const altro = `altro-${Date.now()}`;
    for (let i = 0; i < 5; i++) recordLoginFailure(req, bloccato);
    expect(isLoginBlocked(req, bloccato)).toBe(true);
    expect(isLoginBlocked(req, altro)).toBe(false);
  });
});
