import { z } from 'zod';
import type { Snapshot } from '../shared/contracts';

export const OfflineSnapshotSchema = z.object({
  version: z.literal(1),
  savedAt: z.string(),
  simulated: z.literal(true),
  goal: z.object({
    title: z.string(), targetCents: z.number().int().nonnegative(), savedCents: z.number().int().nonnegative(),
    targetDate: z.string(), status: z.string(),
  }),
  assessment: z.object({
    status: z.string(), projectedDate: z.string().nullable(), requiredMonthlyCents: z.number().int().nonnegative(),
    dataSufficiency: z.string(),
  }),
  connections: z.array(z.object({
    source: z.string(), label: z.string(), status: z.string(), simulated: z.literal(true),
    lastSyncedAt: z.string().nullable(), coverageEnd: z.string().nullable(),
  })),
});
export type OfflineSnapshot = z.infer<typeof OfflineSnapshotSchema>;

export function createOfflineSnapshot(snapshot: Snapshot, savedAt = new Date().toISOString()): OfflineSnapshot {
  const goal = snapshot.primaryGoal ?? snapshot.goals.find(item => item.id === snapshot.primaryGoalId);
  if (!goal) throw new Error('OFFLINE_SNAPSHOT_REQUIRES_GOAL');
  return OfflineSnapshotSchema.parse({
    version: 1,
    savedAt,
    simulated: true,
    goal: {
      title: goal.title,
      targetCents: goal.targetCents,
      savedCents: goal.savedCents,
      targetDate: goal.targetDate,
      status: snapshot.assessment.status,
    },
    assessment: {
      status: snapshot.assessment.status,
      projectedDate: snapshot.assessment.projectedDate,
      requiredMonthlyCents: snapshot.assessment.requiredMonthlyCents,
      dataSufficiency: snapshot.assessment.dataSufficiency,
    },
    connections: snapshot.dataConnections.map(item => ({
      source: item.source,
      label: item.label,
      status: item.status,
      simulated: true,
      lastSyncedAt: item.lastSyncedAt,
      coverageEnd: item.coverageEnd,
    })),
  });
}

const DB_NAME = 'nova-offline-cache';
const STORE_NAME = 'snapshots';
const LATEST_KEY = 'latest';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveOfflineSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(OfflineSnapshotSchema.parse(snapshot), LATEST_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function loadOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  if (typeof indexedDB === 'undefined') return null;
  const database = await openDatabase();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(LATEST_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  const parsed = OfflineSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function clearOfflineSnapshot(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(LATEST_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
