import type { Snapshot } from '../../shared/contracts';
import { PlanChangePanel } from '../components/PlanChangePanel';

export function PlanChangeScreen({ snapshot, onApplied, onRefresh, onCancel }: {
  snapshot: Snapshot;
  onApplied: (snapshot: Snapshot, review: boolean) => void;
  onRefresh: (snapshot: Snapshot) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex-1 w-full overflow-y-auto no-scrollbar px-4 pb-safe pt-3">
      <PlanChangePanel snapshot={snapshot} onApplied={onApplied} onRefresh={onRefresh} onCancel={onCancel} />
    </div>
  );
}
