import { createContext, useContext, useEffect, useState } from 'react';
import { UserSettings } from '../shared';
import { useDevvitListener } from './useDevvitListener';

const defaultUserSettings: UserSettings = {
  sortDirection: 'DESC',
  sortType: 'SIMILARITY',
  layout: 'CONDENSED',
  isUserOptedIntoReminders: false,
};

const UserSettingsContext = createContext<UserSettings>(defaultUserSettings);
const UserSettingsUpdaterContext = createContext<React.Dispatch<
  React.SetStateAction<UserSettings>
> | null>(null);

export const UserSettingsContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [challenge, setUserSettings] = useState<UserSettings>(defaultUserSettings);
  const reminders = useDevvitListener('TOGGLE_USER_REMINDER_RESPONSE');

  useEffect(() => {
    if (!reminders) return;

    setUserSettings({
      ...challenge,
      isUserOptedIntoReminders: reminders.isUserOptedIntoReminders,
    });
  }, [reminders]);

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
