// A few of the most visible bot strings in Spanish and French. Anything missing falls back to English.
export const LANGS = { en: "English", es: "Español", fr: "Français" };
const T = {
    es: { "Stop watching": "Dejar de seguir", "Snooze 7 days": "Posponer 7 días", "Only below a price…": "Solo bajo un precio…", "Steam page": "Página de Steam", "Price history": "Historial de precios", "View deal": "Ver oferta",
        "Welcome": "Bienvenido", "Nav:Wishlist": "Lista de deseos", "Nav:Library": "Biblioteca", "Nav:Alerts": "Alertas", "Nav:Support": "Soporte", "Nav:Notifications": "Avisos", "Was this helpful?": "¿Te sirvió?" },
    fr: { "Stop watching": "Ne plus suivre", "Snooze 7 days": "Reporter 7 jours", "Only below a price…": "Seulement sous un prix…", "Steam page": "Page Steam", "Price history": "Historique des prix", "View deal": "Voir l'offre",
        "Welcome": "Bienvenue", "Nav:Wishlist": "Liste de souhaits", "Nav:Library": "Bibliothèque", "Nav:Alerts": "Alertes", "Nav:Support": "Assistance", "Nav:Notifications": "Notifications", "Was this helpful?": "Cela vous a aidé ?" }
};
export const tr = (lang, key) => T[lang]?.[key] ?? key.replace(/^Nav:/, "");
export const dictionary = lang => T[lang] ?? {};
