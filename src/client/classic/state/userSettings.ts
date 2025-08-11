import { localStorageSignal } from '../../utils/localStorageSignal';

export type SortDirection = 'ASC' | 'DESC';
export type SortType = 'SIMILARITY' | 'TIMESTAMP';
export type Layout = 'CONDENSED' | 'EXPANDED';

export type UserSettings = {
  sortDirection: SortDirection;
  sortType: SortType;
  layout: Layout;
  isUserOptedIntoReminders: boolean;
};

export const userSettings = localStorageSignal<UserSettings>({
  key: 'hotandcold:userSettings:v1',
  initialValue: {
    sortDirection: 'DESC',
    sortType: 'SIMILARITY',
    layout: 'CONDENSED',
    isUserOptedIntoReminders: false,
  },
});

export function toggleLayout() {
  const cur = userSettings.value;
  userSettings.value = { ...cur, layout: cur.layout === 'CONDENSED' ? 'EXPANDED' : 'CONDENSED' };
}

export function toggleSortType() {
  const cur = userSettings.value;
  userSettings.value = {
    ...cur,
    sortType: cur.sortType === 'SIMILARITY' ? 'TIMESTAMP' : 'SIMILARITY',
  };
}

export function setSortDirection(dir: SortDirection) {
  const cur = userSettings.value;
  userSettings.value = { ...cur, sortDirection: dir };
}

export function setReminderOptIn(flag: boolean) {
  const cur = userSettings.value;
  userSettings.value = { ...cur, isUserOptedIntoReminders: flag };
}
