import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../app/core.js';

// requirements.md 4.5 のスラッグ順
const SLUGS = 'ryu, luke, jamie, chunli, guile, kimberly, juri, ken, blanka, dhalsim, ehonda, deejay, manon, marisa, jp, zangief, lily, cammy, rashid, aki, ed, gouki_akuma, vega_mbison, terry, mai, elena, sagat, cviper, alex, ingrid, yasmine, arjun'.split(', ');

test('キャラクターマスタは32件', () => {
  assert.equal(CHARACTERS.length, 32);
});

test('idは非空で重複しない', () => {
  assert.ok(CHARACTERS.every((c) => typeof c.id === 'string' && c.id !== ''));
  assert.equal(new Set(CHARACTERS.map((c) => c.id)).size, CHARACTERS.length);
});

test('表示名は非空', () => {
  assert.ok(CHARACTERS.every((c) => typeof c.name === 'string' && c.name !== ''));
});

test('idの並びが4.5のスラッグ順と一致する', () => {
  assert.deepEqual(CHARACTERS.map((c) => c.id), SLUGS);
});
