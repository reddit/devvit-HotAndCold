import { useMemo } from 'preact/hooks';
import { Modal } from '../shared/modal';
import { experimentsOpen, closeExperiments, bumpRemountKey } from './state/experiments';
import { experiments, experimentDefinitions } from '../../shared/experiments/experiments';
import { context } from '@devvit/web/client';

export function ExperimentsModal() {
  const expKeys = useMemo(() => Object.keys(experimentDefinitions) as string[], []);

  return (
    <Modal isOpen={experimentsOpen.value} onClose={closeExperiments}>
      <div className="w-[92vw] max-w-xl p-6">
        <h3 className="mb-4 text-xl font-bold dark:text-white">Experiments</h3>
        <div className="space-y-4">
          {expKeys.map((key) => {
            const userId = context.userId ?? '';
            const assignment = experiments.evaluate(userId, key as any);
            const treatments = (experimentDefinitions as any)[key]?.treatments as
              | readonly string[]
              | undefined;
            return (
              <div key={key} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium dark:text-white">{key}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    bucket {assignment.bucket} {assignment.overridden ? '(overridden)' : ''}
                  </div>
                </div>
                <select
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  value={assignment.treatment}
                  onChange={(e) => {
                    const next = (e.currentTarget as HTMLSelectElement).value as any;
                    const uid = context.userId ?? '';
                    (experiments as any).updateOverrides(key as any, { [uid]: next });
                    bumpRemountKey();
                  }}
                >
                  {(treatments ?? []).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
