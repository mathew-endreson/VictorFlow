import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps } from 'react-native';
import { LOCALES, LOCALE_META } from '@victorflow/i18n';
import { useI18n } from './i18n';

/**
 * Palette from the VP · By.CREATIVE logo: near-black, one bold red, off-white paper.
 * Buttons are black (white in dark mode) and red is the single accent — so a red button always means "danger".
 */
export interface Palette {
  bg: string; surface: string; ink: string; muted: string; line: string;
  brand: string; primary: string; primaryInk: string; info: string; ok: string; warn: string; bad: string; dark: boolean;
}
const LIGHT: Palette = { bg: '#f2f0f1', surface: '#ffffff', ink: '#1f1e1f', muted: '#6b6768', line: '#e5e1e2', brand: '#e9313a', primary: '#1f1e1f', primaryInk: '#ffffff', info: '#2b5fc9', ok: '#16803c', warn: '#b45309', bad: '#b42318', dark: false };
const DARK: Palette = { bg: '#121112', surface: '#1b1a1b', ink: '#f2f0f1', muted: '#a39ea0', line: '#322f30', brand: '#ff4b53', primary: '#f2f0f1', primaryInk: '#1f1e1f', info: '#7aa2f7', ok: '#4ade80', warn: '#fbbf24', bad: '#f87171', dark: true };

export const usePalette = (): Palette => (useColorScheme() === 'dark' ? DARK : LIGHT);

/** The VP monogram. Black on light screens, paper-white on dark ones; the red slash is part of the image. */
export function Monogram({ width = 56 }: { width?: number }) {
  const c = usePalette();
  return <Image accessibilityLabel="VP" source={c.dark ? require('../assets/monogram-light.png') : require('../assets/monogram-dark.png')} style={{ width, height: width * (679 / 965) }} resizeMode="contain" />;
}

/** "By.CREATIVE" as set in the logo: a light red "By." and a heavy, widely spaced "CREATIVE". */
export function ByCreative({ size = 10 }: { size?: number }) {
  const c = usePalette();
  return (
    <Text style={{ writingDirection: 'ltr', fontSize: size, color: c.ink }}>
      <Text style={{ color: c.brand, fontWeight: '300' }}>By.</Text>
      <Text style={{ fontWeight: '800', letterSpacing: size * 0.16 }}>CREATIVE</Text>
    </Text>
  );
}

export function Button({ label, onPress, variant = 'primary', disabled, busy }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const c = usePalette();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.bad : c.surface;
  const fg = variant === 'secondary' ? c.ink : variant === 'primary' ? c.primaryInk : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: variant === 'secondary' ? c.line : bg, opacity: disabled || busy ? 0.45 : pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

/** Text field. `ltr` for e-mail, URL and password: those are always typed left-to-right, also in an Arabic interface. */
export function Field({ label, ltr, ...props }: { label: string; ltr?: boolean } & TextInputProps) {
  const c = usePalette();
  return (
    <View style={{ gap: 5 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        accessibilityLabel={label}
        style={[
          styles.input,
          { backgroundColor: c.surface, borderColor: c.line, color: c.ink },
          // layout direction of the field itself: start-aligned text then means "left" even in an Arabic (right-to-left) app
          ltr && { direction: 'ltr', writingDirection: 'ltr' },
          props.multiline && { minHeight: 84, textAlignVertical: 'top' },
        ]}
      />
    </View>
  );
}

export function Pill({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' }) {
  const c = usePalette();
  const color = tone === 'muted' ? c.muted : c[tone];
  return (
    <View style={[styles.pill, { borderColor: `${color}55`, backgroundColor: `${color}1f` }]}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const c = usePalette();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>{children}</View>;
}

/** English | العربية. Switching language flips the layout direction, which restarts the app (see i18n/index.tsx). */
export function LanguageSwitch() {
  const c = usePalette();
  const { locale, setLocale, t } = useI18n();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('common.language')} style={[styles.switch, { borderColor: c.line, backgroundColor: c.surface }]}>
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => void setLocale(l)} style={[styles.switchItem, active && { backgroundColor: c.primary }]}>
            <Text style={{ color: active ? c.primaryInk : c.muted, fontWeight: '700', fontSize: 12 }}>{LOCALE_META[l].nativeName}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { minHeight: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 15, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  switch: { flexDirection: 'row', borderWidth: 1, borderRadius: 8, padding: 2, alignSelf: 'flex-start' },
  switchItem: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
});
