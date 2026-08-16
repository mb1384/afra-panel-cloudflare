import type { BalanceStrategy, HealthState, ProxyNode } from './types.js';

export interface BalancerCandidate {
  id: string;
  priority: number;
  weight: number;
  health: HealthState;
  latencyMs: number | null;
  enabled: boolean;
}

const HEALTH_RANK: Record<HealthState, number> = {
  healthy: 0,
  degraded: 1,
  unknown: 2,
  unreachable: 3,
  disabled: 4,
};

export function toCandidate(node: ProxyNode): BalancerCandidate {
  return {
    id: node.id,
    priority: node.priority,
    weight: node.weight,
    health: node.health,
    latencyMs: node.latencyMs,
    enabled: node.enabled,
  };
}

export function isUsable(candidate: BalancerCandidate): boolean {
  return candidate.enabled && candidate.health !== 'unreachable' && candidate.health !== 'disabled';
}

/**
 * مرتب‌سازی قطعی کاندیداها بر اساس استراتژی.
 * همیشه Nodeهای سالم مقدم هستند تا failover طبیعی رخ دهد.
 */
export function rankCandidates(
  candidates: BalancerCandidate[],
  strategy: BalanceStrategy,
): BalancerCandidate[] {
  const usable = candidates.filter(isUsable);
  const sorted = [...usable].sort((a, b) => {
    const healthDiff = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
    if (strategy === 'health' && healthDiff !== 0) return healthDiff;

    if (strategy === 'latency') {
      const la = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
      const lb = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
      if (la !== lb) return la - lb;
    }

    if (a.priority !== b.priority) return a.priority - b.priority;

    if (strategy === 'weight' || strategy === 'priority') {
      if (a.weight !== b.weight) return b.weight - a.weight;
    }

    if (healthDiff !== 0) return healthDiff;
    const la = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
    const lb = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    return a.id.localeCompare(b.id);
  });
  return sorted;
}

/**
 * انتخاب یک کاندیدا. برای استراتژی weight از انتخاب وزنی استفاده می‌شود
 * (rand باید عددی در [0,1) باشد تا تست قطعی بماند).
 */
export function pickCandidate(
  candidates: BalancerCandidate[],
  strategy: BalanceStrategy,
  rand: number = Math.random(),
): BalancerCandidate | null {
  const ranked = rankCandidates(candidates, strategy);
  if (ranked.length === 0) return null;
  if (strategy !== 'weight') return ranked[0];

  const topPriority = ranked[0].priority;
  const tier = ranked.filter((c) => c.priority === topPriority);
  const totalWeight = tier.reduce((sum, c) => sum + Math.max(c.weight, 0), 0);
  if (totalWeight <= 0) return tier[0];
  let threshold = Math.min(Math.max(rand, 0), 0.999999) * totalWeight;
  for (const candidate of tier) {
    threshold -= Math.max(candidate.weight, 0);
    if (threshold < 0) return candidate;
  }
  return tier[tier.length - 1];
}

/** failover: کاندیدای بعدی بعد از حذف شناسه‌های ناموفق. */
export function failover(
  candidates: BalancerCandidate[],
  strategy: BalanceStrategy,
  failedIds: string[],
): BalancerCandidate | null {
  const remaining = candidates.filter((c) => !failedIds.includes(c.id));
  const ranked = rankCandidates(remaining, strategy);
  return ranked[0] ?? null;
}
