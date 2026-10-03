import type { desktopEn } from './en';

// Messages du client de bureau en français.
// French is not selectable yet (packages/i18n LOCALES = en, ar): this catalogue grows key by key until the French
// task turns the language on. catalog.test.ts checks every key here exists in en.ts with the same placeholders.

export const desktopFr: Partial<Record<keyof typeof desktopEn, string>> = {
  'server.checking': 'Connexion au serveur VictorFlow…',
  'server.unreachable.title': 'Impossible de joindre le serveur VictorFlow',
  'server.unreachable.tried': 'Cet ordinateur a essayé de se connecter à',
  'server.reason.unreachable': "Rien n'a répondu à cette adresse. L'ordinateur serveur est peut-être éteint, sur un autre réseau, ou son adresse a changé.",
  'server.reason.timeout': "Le serveur n'a pas répondu à temps. Le réseau est peut-être lent, ou un pare-feu bloque la connexion.",
  'server.reason.notVictorflow': "Quelque chose a répondu à cette adresse, mais ce n'est pas un serveur VictorFlow. Vérifiez l'adresse et le port.",
  'server.reason.databaseDown': "Le serveur VictorFlow fonctionne, mais sa base de données est arrêtée. Redémarrez l'ordinateur serveur, ou lancez « vf-server status » dessus.",
  'server.help': "Vérifiez que l'ordinateur serveur est allumé et connecté au même réseau, puis réessayez. Sur le serveur, « vf-server status » affiche son adresse.",
  'server.autoRetry': 'Nouvel essai automatique toutes les {seconds} s.',
  'server.lost': 'Connexion au serveur perdue :',
};
