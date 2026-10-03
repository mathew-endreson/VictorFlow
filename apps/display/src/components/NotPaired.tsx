import { DISPLAY_LANGS, dirOf, displayMessages } from '@/i18n/messages';
import { Monogram } from './Monogram';

/** What a TV shows until it is paired with a board (pairing and the boards themselves arrive with the Displays module). */
export function NotPaired() {
  return (
    <main className="screen">
      <Monogram className="mark" />
      <div className="messages">
        {DISPLAY_LANGS.map((lang) => (
          <section key={lang} lang={lang} dir={dirOf(lang)} className="message">
            <h1>{displayMessages[lang]['notPaired.title']}</h1>
            <p>{displayMessages[lang]['notPaired.body']}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
