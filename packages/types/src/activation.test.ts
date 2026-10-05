import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  activationCodeFrom,
  checkCharacter,
  decodeRequestCode,
  encodeRequestCode,
  formatActivationCode,
  isValidActivationCode,
  normalizeActivationCode,
} from './activation';

const HW = 'a3f9b7c459c24e0f93a50d8f1d3e7b22a3f9b7c459c24e0f93a50d8f1d3e7b22';
const CODE = activationCodeFrom([5, 18, 0, 19, 7, 22, 29, 8, 2, 25, 23]);

describe('activation code', () => {
  it('has the VF-XXXX-XXXX-XXXX shape, alphabet characters only, and a valid check character', () => {
    expect(CODE).toMatch(/^VF-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(isValidActivationCode(CODE)).toBe(true);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
  });

  it('accepts any spacing, case and with or without the VF prefix', () => {
    const body = CODE.replace(/^VF-/, '').replace(/-/g, '');
    for (const typed of [CODE, CODE.toLowerCase(), body, `vf ${body.slice(0, 4)} ${body.slice(4, 8)} ${body.slice(8)}`, ` ${CODE} `]) {
      expect(normalizeActivationCode(typed)).toBe(body);
      expect(formatActivationCode(typed)).toBe(CODE);
    }
  });

  it('detects EVERY single wrong character', () => {
    const body = normalizeActivationCode(CODE)!;
    for (let i = 0; i < body.length; i++) {
      for (const c of CODE_ALPHABET) {
        if (c === body[i]) continue;
        expect(isValidActivationCode(body.slice(0, i) + c + body.slice(i + 1))).toBe(false);
      }
    }
  });

  it('detects EVERY swap of two neighbouring characters', () => {
    // over many random codes, so the property is not an accident of one example
    for (let n = 0; n < 200; n++) {
      const code = normalizeActivationCode(activationCodeFrom(Array.from({ length: 11 }, () => Math.floor(Math.random() * 32))))!;
      for (let i = 0; i < code.length - 1; i++) {
        if (code[i] === code[i + 1]) continue;
        const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
        expect(isValidActivationCode(swapped)).toBe(false);
      }
    }
  });

  it('refuses the wrong length, foreign characters, and building a code from bad indexes', () => {
    expect(isValidActivationCode('')).toBe(false);
    expect(isValidActivationCode('VF-7K2M-9QXA')).toBe(false);
    expect(isValidActivationCode(`${CODE}2`)).toBe(false);
    expect(isValidActivationCode(CODE.replace(/.$/, 'O'))).toBe(false);
    expect(() => formatActivationCode('nope')).toThrow();
    expect(() => activationCodeFrom([1, 2, 3])).toThrow();
    expect(() => activationCodeFrom(Array(11).fill(32))).toThrow();
    expect(() => checkCharacter('ABC0')).toThrow();
  });
});

describe('request code', () => {
  it('round-trips the activation code and the hardware id', () => {
    const req = encodeRequestCode({ activationCode: CODE, hardwareId: HW });
    expect(req).toMatch(/^VFR1(-[2-9A-HJ-NP-Z]{1,5})+$/);
    expect(decodeRequestCode(req)).toEqual({ activationCode: CODE, hardwareId: HW });
  });

  it('survives WhatsApp and dictation: spaces, line breaks, lower case, no dashes', () => {
    const req = encodeRequestCode({ activationCode: CODE, hardwareId: HW });
    const mangled = req.toLowerCase().replace(/-/g, ' ').replace(/(.{20})/g, '$1\n');
    expect(decodeRequestCode(mangled)).toEqual({ activationCode: CODE, hardwareId: HW });
    expect(decodeRequestCode(req.replace(/-/g, ''))).toEqual({ activationCode: CODE, hardwareId: HW });
  });

  it('refuses a request code with any single character changed, or cut short', () => {
    const req = encodeRequestCode({ activationCode: CODE, hardwareId: HW });
    const chars = req.replace(/^VFR1-/, '').replace(/-/g, '');
    for (let i = 0; i < chars.length; i++) {
      const other = CODE_ALPHABET[(CODE_ALPHABET.indexOf(chars[i]!) + 7) % 32]!;
      expect(decodeRequestCode(`VFR1${chars.slice(0, i)}${other}${chars.slice(i + 1)}`)).toBeNull();
    }
    expect(decodeRequestCode(req.slice(0, -1))).toBeNull();
    expect(decodeRequestCode(CODE)).toBeNull();
    expect(decodeRequestCode('')).toBeNull();
  });

  it('refuses to encode a bad code or hardware id', () => {
    expect(() => encodeRequestCode({ activationCode: 'VF-0000-0000-0000', hardwareId: HW })).toThrow();
    expect(() => encodeRequestCode({ activationCode: CODE, hardwareId: 'ABC' })).toThrow();
    expect(() => encodeRequestCode({ activationCode: CODE, hardwareId: HW.toUpperCase() })).toThrow();
  });
});
