// The TV screens' wording, in the three languages of the shop. A TV has no one to pick a language, so the placeholder
// shows all three at once (French, Arabic, English). messages.test.ts checks the three have the same keys.

export const DISPLAY_LANGS = ['fr', 'ar', 'en'] as const;
export type DisplayLang = (typeof DISPLAY_LANGS)[number];

export const displayMessages = {
  en: {
    'meta.title': 'VictorFlow display',
    'notPaired.title': 'This screen is not paired yet',
    'notPaired.body': 'Pair it from VictorFlow on a company computer: Settings → Displays. The production board and the client board will appear here.',
  },
  fr: {
    'meta.title': 'Écran VictorFlow',
    'notPaired.title': "Cet écran n'est pas encore associé",
    'notPaired.body': "Associez-le depuis VictorFlow sur un ordinateur de l'entreprise : Paramètres → Écrans. Le tableau de production et le tableau clients s'afficheront ici.",
  },
  ar: {
    'meta.title': 'شاشة VictorFlow',
    'notPaired.title': 'هذه الشاشة غير مقترنة بعد',
    'notPaired.body': 'اقرنها من VictorFlow على أحد حواسيب المؤسسة: الإعدادات ← الشاشات. ستظهر هنا لوحة الإنتاج ولوحة الزبائن.',
  },
} as const satisfies Record<DisplayLang, Record<string, string>>;

export type DisplayKey = keyof (typeof displayMessages)['en'];

export const dirOf = (lang: DisplayLang) => (lang === 'ar' ? 'rtl' : 'ltr');
