import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import App from './App';
import { AppProvider } from './context/AppContext';

const Stack = createNativeStackNavigator();

registerRootComponent(() => (
  <SafeAreaProvider>
    <AppProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={App} />
        </Stack.Navigator>
      </NavigationContainer>
    </AppProvider>
  </SafeAreaProvider>
));