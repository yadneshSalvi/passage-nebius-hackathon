import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { FixtureHost, type FixtureBuild } from '../engine/host.js';
import { getReferenceSource, scenarioDefinitions } from '../engine/catalog.js';
import { createFixtureTemporalContract, runFixtureTemporal } from '../engine/temporal-fixture.js';

describe('authored temporal wrapper browser lifetime', () => {
  let directory: string, host: FixtureHost, build: FixtureBuild;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'passage-fixture-cancel-test-'));
    host = new FixtureHost({ previewPort: 0, artifactRoot: directory }); await host.start();
    build = await host.prepareBuild({ fixtureId: 'northstar-appointments', source: await getReferenceSource('northstar-appointments') });
  });
  afterAll(async () => { await host?.close(); await rm(directory, { recursive: true, force: true }); });

  it('retains a cancelled execution and closes the actual browser after a pending availability request', async () => {
    const controller = new AbortController(), launched: Browser[] = [];
    let sawPendingRequest = false, usedSafetyDeadline = false;
    const actualLaunch = chromium.launch.bind(chromium);
    const launch = vi.spyOn(chromium, 'launch').mockImplementation(async options => {
      const browser = await actualLaunch(options); launched.push(browser);
      const actualNewContext = browser.newContext.bind(browser);
      vi.spyOn(browser, 'newContext').mockImplementation(async options => {
        const context = await actualNewContext(options);
        context.on('request', request => {
          if (!request.url().endsWith('/availability') || sawPendingRequest) return;
          sawPendingRequest = true;
          // This is an external operator cancellation during actual I/O, rather
          // than the contract's separate Escape/late-response test action.
          setTimeout(() => controller.abort(new Error('Test operator cancelled during pending availability')), 50);
        });
        return context;
      });
      return browser;
    });
    const safety = setTimeout(() => { usedSafetyDeadline = true; controller.abort(new Error('Test safety deadline')); }, 8000);
    try {
      const contract = createFixtureTemporalContract({ scheduleId: 'cancel-pending', choiceDate: '2026-11-16' });
      const execution = await runFixtureTemporal({ host, build, scenario: scenarioDefinitions.find(scenario => scenario.id === 'late-validation')!, contract, signal: controller.signal });
      expect(sawPendingRequest).toBe(true); expect(usedSafetyDeadline).toBe(false);
      expect(execution.status).toBe('cancelled'); expect(execution.passed).toBe(false); expect(execution.failureSignature).toBeNull();
      expect(execution.identity).toMatchObject({ adapter: 'authored-fixture-temporal-v3', sourceDigest: build.digest, buildId: build.id, contractDigest: contract.digest });
      expect(execution.trace.some(event => event.provenance === 'browser-network' && event.kind === 'request' && event.label.endsWith('/availability') && event.requestId)).toBe(true);
      expect(execution.checks.some(check => check.status === 'not-run')).toBe(true);
      expect(launched).toHaveLength(1); expect(launched.every(browser => !browser.isConnected())).toBe(true);
      expect((await host.getSession(execution.identity.sessionId)).outcome).toBeNull();
    } finally {
      clearTimeout(safety); launch.mockRestore();
      await Promise.allSettled(launched.map(browser => browser.close()));
    }
  }, 15000);

  it('keeps the ordinary protected-outcome recording path passing and closes its browser', async () => {
    const launched: Browser[] = [], actualLaunch = chromium.launch.bind(chromium);
    const launch = vi.spyOn(chromium, 'launch').mockImplementation(async options => { const browser = await actualLaunch(options); launched.push(browser); return browser; });
    try {
      const execution = await runFixtureTemporal({ host, build, scenario: scenarioDefinitions[0], contract: createFixtureTemporalContract({ scheduleId: 'baseline', choiceDate: '2026-11-16' }) });
      expect(execution.status).toBe('passed'); expect(execution.checks.every(check => check.status === 'passed')).toBe(true);
      expect(execution.identity.adapter).toBe('authored-fixture-temporal-v3');
      expect(execution.trace.some(event => event.kind === 'response' && event.requestId)).toBe(true);
      expect((await host.getSession(execution.identity.sessionId)).outcome).toMatchObject({ date: '2026-11-16', attendee: 'Alex Morgan' });
      expect(launched).toHaveLength(1); expect(launched.every(browser => !browser.isConnected())).toBe(true);
    } finally { launch.mockRestore(); await Promise.allSettled(launched.map(browser => browser.close())); }
  }, 15000);
});
