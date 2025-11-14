// src/navigation/MainTabs.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MyAlertsScreen from '../screens/Alerts/MyAlertsScreen';
import CreateAlertScreen from '../screens/Alerts/CreateAlertScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';
import { Colors } from '../constants/theme';
import { useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const colorScheme = useColorScheme();
  const colorSet = Colors[colorScheme ?? 'light'];

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colorSet.tabIconSelected,
        tabBarInactiveTintColor: colorSet.tabIconDefault,
        tabBarIcon: ({ color, size }) => {
          const iconMap: Record<string, string> = {
            MyAlerts: 'golf-outline',
            CreateAlert: 'add-circle-outline',
            Profile: 'person-outline',
          };
          const name = iconMap[route.name] as any;
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="MyAlerts" component={MyAlertsScreen} options={{ title: 'My Alerts' }} />
      <Tab.Screen
        name="CreateAlert"
        component={CreateAlertScreen}
        options={{ title: 'Create Alert' }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}