import { test, expect } from 'bun:test';
import { defaultKimiDirectory } from './adapter.mjs';

// Kimi's daimon folder on each system, as Kimi 3.2.21 finds it
// (magpie-community/plugins#425).
const files = m => file => { if (!(file in m)) throw Object.assign(Error('ENOENT'), { code: 'ENOENT' }); return m[file]; };
const win = { platform: 'win32', appdata: 'C:\\Users\\u\\AppData\\Roaming' };

test('each system\'s default with no pointer', () => {
  expect(defaultKimiDirectory('C:\\Users\\u', { ...win, read: files({}) })).toBe('C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon');
  expect(defaultKimiDirectory('/Users/u', { platform: 'darwin', read: files({}) })).toBe('/Users/u/Library/Application Support/kimi-desktop/daimon-share/daimon');
  expect(defaultKimiDirectory('/home/u', { platform: 'linux', read: files({}) })).toBe('/home/u/.config/kimi-desktop/daimon-share/daimon');
});

test('the shareDir daimon-storage.json names, as Kimi on another Windows drive writes it', () => {
  const read = files({ 'C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-storage.json': JSON.stringify({ version: 1, shareDir: 'D:\\KimiData\\daimon-share' }) });
  expect(defaultKimiDirectory('C:\\Users\\u', { ...win, read })).toBe('D:\\KimiData\\daimon-share\\daimon');
  const mac = files({ '/Users/u/Library/Application Support/kimi-desktop/daimon-storage.json': JSON.stringify({ version: 1, shareDir: '/Volumes/X/daimon-share' }) });
  expect(defaultKimiDirectory('/Users/u', { platform: 'darwin', read: mac })).toBe('/Volumes/X/daimon-share/daimon');
});

test('a pointer Kimi would not take leaves the default', () => {
  for (const body of ['nope', '{}', JSON.stringify({ shareDir: 'relative\\x' }), JSON.stringify({ shareDir: 1 })])
    expect(defaultKimiDirectory('C:\\Users\\u', { ...win, read: files({ 'C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-storage.json': body }) }))
      .toBe('C:\\Users\\u\\AppData\\Roaming\\kimi-desktop\\daimon-share\\daimon');
});
