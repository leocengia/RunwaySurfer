// asyncRoute: l'adattatore fra handler async e middleware d'errore di Express 4.
//
// Perché ha un test dedicato: senza il wrapper, la rejection di un handler
// `async` non raggiunge nessuno e su Node diventa un `unhandledRejection` che
// TERMINA il processo — cioè il backend muore per tutti gli agenti a causa di una
// singola richiesta. Aggiungere l'error middleware senza questo pezzo non
// cambierebbe nulla, perché il middleware non vedrebbe mai quegli errori.
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { asyncRoute } from '../src/http.js';

const req = {} as Request;
const res = {} as Response;

describe('asyncRoute', () => {
  it('inoltra a next() l’errore di un handler che rigetta', async () => {
    const boom = new Error('provider giù');
    const next = vi.fn() as unknown as NextFunction;
    asyncRoute(async () => {
      throw boom;
    })(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(boom));
  });

  it('non chiama next() quando l’handler va a buon fine', async () => {
    const next = vi.fn() as unknown as NextFunction;
    const handler = vi.fn(async () => undefined);
    asyncRoute(handler)(req, res, next);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect(next).not.toHaveBeenCalled();
  });

  it('passa req, res e next all’handler', async () => {
    const handler = vi.fn(async () => undefined);
    const next = vi.fn() as unknown as NextFunction;
    asyncRoute(handler)(req, res, next);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(req, res, next));
  });

  it('cattura anche un throw sincrono dentro l’handler async', async () => {
    // Un `throw` prima del primo `await` produce comunque una promise rigettata.
    const next = vi.fn() as unknown as NextFunction;
    asyncRoute(() => {
      throw new Error('subito');
    })(req, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
  });
});
