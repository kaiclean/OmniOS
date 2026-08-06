import { describe, expect, it } from 'vitest';

import {
  AUTONOMOUS_STAGES,
  UPGRADE_DECISIONS,
  UPGRADE_STAGES,
  type UpgradeStage,
} from '@/lib/domain';
import {
  generateAllReports,
  generateDiscoveries,
  generateLearningReport,
  generateUpgradeCandidates,
  scoreRelevance,
} from '@/lib/generation/intelligence';

const NOW = new Date('2026-03-14T09:00:00.000Z');

/**
 * The Safe Upgrade Pipeline's whole value is one property: the system can reach
 * a recommendation on its own and no further. These tests exist so that property
 * cannot be weakened by accident.
 */
describe('the pipeline stops at the human', () => {
  it('never lists a decision stage as autonomous', () => {
    for (const stage of ['approved', 'rejected', 'extended-testing', 'applied'] as const) {
      expect(AUTONOMOUS_STAGES).not.toContain(stage);
    }
  });

  it('lets the system reach recommendation and awaiting-approval alone', () => {
    for (const stage of ['discovered', 'analysed', 'sandboxed', 'measured', 'compared', 'recommended', 'awaiting-approval'] as const) {
      expect(AUTONOMOUS_STAGES).toContain(stage);
    }
  });

  it('accounts for every stage as either autonomous or human-gated', () => {
    const humanGated: UpgradeStage[] = ['approved', 'rejected', 'extended-testing', 'applied'];
    expect([...AUTONOMOUS_STAGES, ...humanGated].sort()).toEqual([...UPGRADE_STAGES].sort());
  });

  it('offers exactly the three decisions the product promises', () => {
    expect([...UPGRADE_DECISIONS].sort()).toEqual(['approve', 'reject', 'test-longer']);
  });

  it('never generates a candidate past the approval gate', () => {
    const candidates = generateUpgradeCandidates(generateDiscoveries(NOW), NOW);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(AUTONOMOUS_STAGES).toContain(candidate.stage);
      expect(candidate.decision).toBeUndefined();
      expect(candidate.appliedAt).toBeUndefined();
    }
  });

  it('states what was tested for every candidate, including the untested ones', () => {
    for (const candidate of generateUpgradeCandidates(generateDiscoveries(NOW), NOW)) {
      expect(candidate.whatChanged.length).toBeGreaterThan(20);
      expect(candidate.whyItMatters.length).toBeGreaterThan(20);
      expect(candidate.whatWasTested.length).toBeGreaterThan(10);
      expect(candidate.recommendation.length).toBeGreaterThan(10);
      if (!candidate.sandbox) {
        // A candidate with no sandbox run must say so rather than imply one.
        expect(candidate.whatWasTested.toLowerCase()).toMatch(/not yet|no sandbox/);
      }
    }
  });

  it('marks every sandbox metric with the direction that counts as better', () => {
    for (const candidate of generateUpgradeCandidates(generateDiscoveries(NOW), NOW)) {
      for (const metric of candidate.sandbox?.metrics ?? []) {
        expect(['higher', 'lower']).toContain(metric.betterWhen);
        expect(metric.unit).toBeTruthy();
      }
    }
  });

  it('names a mitigation for every risk it raises', () => {
    for (const candidate of generateUpgradeCandidates(generateDiscoveries(NOW), NOW)) {
      for (const risk of candidate.risks) {
        expect(risk.mitigation.length, `${candidate.title}: "${risk.label}" has no mitigation`).toBeGreaterThan(10);
      }
    }
  });

  it('labels everything it produced as simulated', () => {
    const discoveries = generateDiscoveries(NOW);
    expect(discoveries.every((d) => d.simulated)).toBe(true);
    expect(generateUpgradeCandidates(discoveries, NOW).every((c) => c.simulated)).toBe(true);
    expect(generateAllReports(discoveries, generateUpgradeCandidates(discoveries, NOW), NOW).every((r) => r.simulated)).toBe(true);
  });
});

describe('the discovery feed', () => {
  it('is deterministic', () => {
    expect(generateDiscoveries(NOW)).toEqual(generateDiscoveries(NOW));
  });

  it('scores most of what it finds below the bar', () => {
    const discoveries = generateDiscoveries(NOW);
    const signal = discoveries.filter((d) => d.relevance >= 70);
    // A feed where everything is relevant is a hype feed, not an intelligence one.
    expect(signal.length).toBeLessThan(discoveries.length / 2);
    expect(signal.length).toBeGreaterThan(0);
  });

  it('explains every score it gives', () => {
    for (const discovery of generateDiscoveries(NOW)) {
      expect(discovery.relevanceReasons.length, `${discovery.title} has no reasons`).toBeGreaterThan(0);
      expect(discovery.relevance).toBeGreaterThanOrEqual(0);
      expect(discovery.relevance).toBeLessThanOrEqual(100);
    }
  });
});

describe('relevance scoring', () => {
  it('rewards an item that touches something the workspace uses', () => {
    const withInterest = scoreRelevance(
      { title: 'Better memory retrieval', summary: 'Improves memory scoping', kind: 'practice' },
      ['memory'],
    );
    const without = scoreRelevance(
      { title: 'Better memory retrieval', summary: 'Improves memory scoping', kind: 'practice' },
      [],
    );
    expect(withInterest.score).toBeGreaterThan(without.score);
    expect(withInterest.reasons.join(' ')).toContain('memory');
  });

  it('discounts research with no shipped implementation', () => {
    const paper = scoreRelevance({ title: 'A study', summary: 'Findings', kind: 'paper' }, []);
    const practice = scoreRelevance({ title: 'A study', summary: 'Findings', kind: 'practice' }, []);
    expect(paper.score).toBeLessThan(practice.score);
  });

  it('keeps every score inside 0..100', () => {
    const extreme = scoreRelevance(
      { title: 'memory memory memory', summary: 'memory memory', kind: 'practice' },
      Array.from({ length: 20 }, () => 'memory'),
    );
    expect(extreme.score).toBeLessThanOrEqual(100);
    expect(extreme.score).toBeGreaterThanOrEqual(0);
  });
});

describe('learning reports', () => {
  it('leads with what is waiting on the founder when something is', () => {
    const discoveries = generateDiscoveries(NOW);
    const upgrades = generateUpgradeCandidates(discoveries, NOW);
    const report = generateLearningReport('weekly', discoveries, upgrades, NOW);
    const awaiting = upgrades.filter((u) => u.stage === 'awaiting-approval').length;
    if (awaiting > 0) {
      expect(report.headline).toContain('waiting on you');
    }
  });

  it('reports how much noise it filtered, not just the signal', () => {
    const discoveries = generateDiscoveries(NOW);
    const report = generateLearningReport('weekly', discoveries, [], NOW);
    const text = report.sections.flatMap((s) => s.bullets.map((b) => b.text)).join(' ');
    expect(text).toMatch(/below the relevance threshold/);
  });

  it('states plainly that nothing was applied', () => {
    const discoveries = generateDiscoveries(NOW);
    const upgrades = generateUpgradeCandidates(discoveries, NOW);
    const report = generateLearningReport('daily', discoveries, upgrades, NOW);
    const text = report.sections.flatMap((s) => s.bullets.map((b) => b.text)).join(' ');
    expect(text).toMatch(/None were applied/);
  });

  it('produces one report per cadence without id collisions', () => {
    const discoveries = generateDiscoveries(NOW);
    const reports = generateAllReports(discoveries, generateUpgradeCandidates(discoveries, NOW), NOW);
    const ids = reports.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
