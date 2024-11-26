import { createContext, useContext, useState } from 'react';
import { UserSettings } from '../shared';

const defaultUserSettings: UserSettings = {
  sortDirection: 'DESC',
  sortType: 'TIMESTAMP',
  layout: 'CONDENSED',
};

const UserSettingsContext = createContext<UserSettings>(defaultUserSettings);
const UserSettingsUpdaterContext = createContext<React.Dispatch<
  React.SetStateAction<UserSettings>
> | null>(null);

export const UserSettingsContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [challenge, setUserSettings] = useState<UserSettings>(defaultUserSettings);

  return (
    <UserSettingsUpdaterContext.Provider value={setUserSettings}>
      <UserSettingsContext.Provider value={challenge}>{children}</UserSettingsContext.Provider>
    </UserSettingsUpdaterContext.Provider>
  );
};

export const useUserSettings = () => {
  const context = useContext(UserSettingsContext);
  if (context === null) {
    throw new Error('useUserSettings must be used within a UserSettingsContextProvider');
  }
  return context;
};

export const useSetUserSettings = () => {
  const setUserSettings = useContext(UserSettingsUpdaterContext);
  if (setUserSettings === null) {
    throw new Error('useSetUserSettings must be used within a UserSettingsContextProvider');
  }
  return setUserSettings;
};
