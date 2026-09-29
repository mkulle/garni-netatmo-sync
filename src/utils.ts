export const log = (...a: unknown[]): void => console.log(new Date().toISOString(), ...a);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Rounds to one decimal place (temperatures). */
export const round1 = (n: number): number => Math.round(n * 10) / 10;
