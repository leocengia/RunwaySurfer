// Utilità HTTP condivise dalle route.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Adatta un handler async al middleware d'errore di Express 4.
 *
 * PERCHÉ SERVE: Express 4 non conosce le Promise. Se un handler `async` rigetta,
 * nessuno chiama `next(err)`: la rejection resta non gestita e su Node 20 questo
 * TERMINA il processo — cioè il backend muore per tutti gli agenti a causa di una
 * singola richiesta andata storta. Aggiungere l'error middleware senza questo
 * wrapper non cambierebbe nulla: il middleware non vedrebbe mai quegli errori.
 *
 * (In Express 5 il comportamento è nativo e questo wrapper diventa superfluo.)
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res, next).catch(next);
    } catch (e) {
      // Un handler che lancia PRIMA di restituire la promise (una funzione non
      // `async`: il tipo lo consente, perché `never` è assegnabile a `Promise`).
      // Express 4 lo intercetterebbe da sé, ma così l'esito è uno solo invece di
      // dipendere da come è scritto l'handler.
      next(e);
    }
  };
}
