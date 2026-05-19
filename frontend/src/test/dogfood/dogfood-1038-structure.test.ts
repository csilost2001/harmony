/**
 * Dogfood smoke test: ISSUE #1038 /generate-tests NestJS/Next.js 系
 *
 * このテストは生成した test fixture の構造を機械的に検証する。
 * コンポーネント実装を必要とせず、vitest 環境で直接 pass できる最小テスト。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// projectRoot/.tmp/dogfood-1038 を file-URL ベースで解決 (machine 非依存、Dev Container / WSL / native すべてで動作)
// 旧: hardcoded '/home/hidekatsu/projects/harmony/.tmp/dogfood-1038' は当 PC でのみ pass する
const __filename = fileURLToPath(import.meta.url);
const DOGFOOD_ROOT = path.resolve(path.dirname(__filename), '../../../../.tmp/dogfood-1038');

describe('Dogfood #1038: 生成 test fixture structure 検証', () => {

  describe('Step 3 (ProcessFlow cc173367 → jest+supertest)', () => {
    const specFile = path.join(DOGFOOD_ROOT, 'step3/cc173367/session-start.e2e-spec.ts');

    it('ファイルが存在する', () => {
      expect(fs.existsSync(specFile)).toBe(true);
    });

    it('Spec anchor が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('Spec anchor: Flow cc173367');
    });

    it('@nestjs/testing import が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain("from '@nestjs/testing'");
    });

    it('placeholder <<...>> が残存しない', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).not.toContain('<<');
    });

    it('sessionId assert が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('sessionId');
    });

    it('日本語テスト名が 2 件以上含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      const matches = content.match(/it\('#\d/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Step P3 (Screen 496e43f8 → vitest)', () => {
    const specFile = path.join(DOGFOOD_ROOT, 'p3/496e43f8/dashboard.component.test.tsx');

    it('ファイルが存在する', () => {
      expect(fs.existsSync(specFile)).toBe(true);
    });

    it('Spec anchor が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('Spec anchor: Screen 496e43f8');
    });

    it('vitest import が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain("from 'vitest'");
    });

    it('placeholder <<...>> が残存しない', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).not.toContain('<<');
    });

    it('ダッシュボード items が含まれる (streakDays / cefrLevel)', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('streakDays');
      expect(content).toContain('cefrLevel');
    });

    it('日本語テスト名が 2 件以上含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      const matches = content.match(/it\('#\d/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Step P4 (E2E シナリオ → Playwright)', () => {
    const specFile = path.join(DOGFOOD_ROOT, 'p4/scenario-496e43f8-18bcc879/play-session.e2e.spec.ts');

    it('ファイルが存在する', () => {
      expect(fs.existsSync(specFile)).toBe(true);
    });

    it('Spec anchor が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('Spec anchor: Scenario scenario-496e43f8-18bcc879');
    });

    it('Playwright import が含まれる (@playwright/test)', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain("from '@playwright/test'");
    });

    it('placeholder <<...>> が残存しない', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).not.toContain('<<');
    });

    it('両 Screen の代表 items が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('streakDays');    // Screen 496e43f8
      expect(content).toContain('totalScore');    // Screen 18bcc879
    });
  });

  describe('Step P5 (AI flow 96118ae1 → mock + 実 API)', () => {
    const specFile = path.join(DOGFOOD_ROOT, 'p5/96118ae1/conversation-turn.e2e-spec.ts');

    it('ファイルが存在する', () => {
      expect(fs.existsSync(specFile)).toBe(true);
    });

    it('Spec anchor が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('Spec anchor: Flow 96118ae1');
    });

    it('@nestjs/testing import が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain("from '@nestjs/testing'");
    });

    it('placeholder <<...>> が残存しない', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).not.toContain('<<');
    });

    it('mock mode describe が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('mock mode');
    });

    it('RUN_AI_INTEGRATION ternary が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('RUN_AI_INTEGRATION');
    });

    it('AI-4 テスト (provider 失敗 → 502) が含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      expect(content).toContain('AI-4');
      expect(content).toContain('502');
    });

    it('日本語テスト名が 2 件以上含まれる', () => {
      const content = fs.readFileSync(specFile, 'utf-8');
      const matches = content.match(/it\('#/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

});
