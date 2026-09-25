/** Nom affiché : espaces en trop retirés. */
export const cleanName = (name: string): string => name.trim().replace(/\s+/g, " ");

/** Clé d'identité d'un nom : sans casse, accents ni espaces en trop (« Société  A » = « societe a »). */
export const nameKey = (name: string): string =>
  cleanName(name).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr-FR");
