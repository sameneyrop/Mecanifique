import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import React, { useState } from 'react';
import { View } from 'react-native';

import App from './App';
import { AppProvider, useAppContext } from './context/AppContext';
import { AnimatedSplash } from './components/AnimatedSplash';

// La pantalla de carga nativa se queda hasta que la animada la reemplaza
// (ver AnimatedSplash).
SplashScreen.preventAutoHideAsync().catch(() => undefined);

const Stack = createNativeStackNavigator();

// Encima de la app mientras revisa la sesión; luego se desvanece y se quita.
function SplashOverlay() {
  const { loadingSession } = useAppContext();
  const [finished, setFinished] = useState(false);
  if (finished) {
    return null;
  }
  return <AnimatedSplash ready={!loadingSession} onFinish={() => setFinished(true)} />;
}

function Root() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <AppProvider>
        <View style={{ flex: 1 }}>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Main" component={App} />
            </Stack.Navigator>
          </NavigationContainer>
          <SplashOverlay />
        </View>
      </AppProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(Root);
