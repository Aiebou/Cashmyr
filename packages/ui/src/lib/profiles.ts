/** Initiale d'un profil, pour sa pastille : première lettre ou chiffre, en majuscule. */
export function initialOf(name: string): string {
  const first = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? name.trim().charAt(0);
  return first.toLocaleUpperCase("fr-FR");
}
