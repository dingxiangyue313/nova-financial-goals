import { CLAIM_LABELS } from '../../lib/mission-copy';

export function ClaimBadge({ kind }: { kind: keyof typeof CLAIM_LABELS }) {
  return <span className={`mission-claim mission-claim-${kind}`}>{CLAIM_LABELS[kind]}</span>;
}
