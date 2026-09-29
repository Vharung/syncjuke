export const MODULE_ID = "syncjuke";
export const EVENT = `module.${MODULE_ID}`;

/** Journal horodaté (ms depuis le chargement de la page) pour diagnostiquer les lenteurs. */
export const log = (msg) => console.log(`[syncjuke] +${Math.round(performance.now())}ms ${msg}`);
