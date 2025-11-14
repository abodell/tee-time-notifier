// App.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { Provider as PaperProvider } from 'react-native-paper';
import { supabase } from './lib/supabase';
import RootNavigator from './navigation/RootNavigator';
import { PaperLightTheme, PaperDarkTheme } from './constants/theme';
import { useColorScheme } from 'react-native';
import { Session } from '@supabase/supabase-js';
import "react-native-reanimated";

export default function App() {
  const colorScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  const isDark = colorScheme === 'dark';

  return (
    <PaperProvider theme={isDark ? PaperDarkTheme : PaperLightTheme}>
      <NavigationContainer theme={isDark ? DarkTheme : DefaultTheme}>
        <RootNavigator session={session} />
      </NavigationContainer>
    </PaperProvider>
  );
}