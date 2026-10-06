import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card } from './ui';
import { requestAccountSection, requestMechanicTab, type AccountSection, type MechanicTab } from '../navigationRequests';
import type { ApiCall } from '../App';

/**
 * "Completa tu perfil" en Inicio: recomendaciones de qué hacer después, cada
 * una lleva directo a donde se hace (servidor: src/profileChecklist.ts). Se
 * esconde cuando todo está listo, o una semana si la persona la oculta.
 */

type IconName = ComponentProps<typeof Ionicons>['name'];
type Target = { screen: 'vehicles' | 'mechanics' | 'account' } | { account: AccountSection } | { mechanicTab: MechanicTab };
type Recommendation = { title: string; icon: IconName; target: Target };

const RECOMMENDATIONS: Record<string, Recommendation> = {
  // Cliente
  name: {
    title: 'Pon tu nombre',
    icon: 'person-outline',
    target: { account: 'personal' },
  },
  photo: {
    title: 'Agrega tu foto',
    icon: 'camera-outline',
    target: { screen: 'account' },
  },
  phone: {
    title: 'Agrega tu teléfono',
    icon: 'call-outline',
    target: { account: 'personal' },
  },
  vehicle: {
    title: 'Agrega tu auto',
    icon: 'car-sport-outline',
    target: { screen: 'vehicles' },
  },
  favorite: {
    title: 'Guarda un mecánico favorito',
    icon: 'heart-outline',
    target: { screen: 'mechanics' },
  },
  // Mecánico
  cover: {
    title: 'Sube una foto de portada',
    icon: 'image-outline',
    target: { mechanicTab: 'profile' },
  },
  bio: {
    title: 'Escribe tu descripción',
    icon: 'create-outline',
    target: { mechanicTab: 'profile' },
  },
  gallery: {
    title: 'Sube fotos de tu trabajo',
    icon: 'images-outline',
    target: { mechanicTab: 'profile' },
  },
  schedule: {
    title: 'Publica horarios en tu agenda',
    icon: 'calendar-outline',
    target: { mechanicTab: 'schedule' },
  },
  tips: {
    title: 'Agrega tu CLABE para propinas',
    icon: 'wallet-outline',
    target: { mechanicTab: 'profile' },
  },
  promotion: {
    title: 'Publica una promoción',
    icon: 'pricetag-outline',
    target: { mechanicTab: 'promotions' },
  },
};

const HIDE_DAYS = 7;

export function ProfileChecklist({ api }: { api: ApiCall }) {
  const { user, setCurrentScreen } = useAppContext();
  const [items, setItems] = useState<Array<{ key: string; done: boolean }> | null>(null);
  const [hidden, setHidden] = useState(true);
  const hideKey = user ? `mecanifique.checklist.hidden.${user.role}.${user.id}` : null;
  // App crea `api` de nuevo en cada render: en un ref para cargar solo al
  // montarse (Inicio se vuelve a montar cada vez que se regresa a él).
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let cancelled = false;
    apiRef.current<{ items: Array<{ key: string; done: boolean }> }>('/api/account/profile-checklist')
      .then((data) => {
        if (!cancelled) setItems(data.items.filter((item) => RECOMMENDATIONS[item.key]));
      })
      .catch(() => undefined);
    if (hideKey) {
      AsyncStorage.getItem(hideKey)
        .then((until) => {
          if (!cancelled) setHidden(Boolean(until && Number(until) > Date.now()));
        })
        .catch(() => setHidden(false));
    }
    return () => {
      cancelled = true;
    };
  }, [hideKey]);

  if (!items || hidden || items.every((item) => item.done)) {
    return null;
  }

  const doneCount = items.filter((item) => item.done).length;

  function open(target: Target) {
    if ('screen' in target) {
      setCurrentScreen(target.screen);
    } else if ('account' in target) {
      requestAccountSection(target.account);
      setCurrentScreen('account');
    } else {
      requestMechanicTab(target.mechanicTab);
      setCurrentScreen('actions');
    }
  }

  function hide() {
    setHidden(true);
    if (hideKey) AsyncStorage.setItem(hideKey, String(Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000)).catch(() => undefined);
  }

  return (
    <Animated.View entering={FadeInDown.duration(300)} needsOffscreenAlphaCompositing>
      <Card
        title="Completa tu perfil"
        subtitle={`${doneCount} de ${items.length} listos`}
      >
        <View style={styles.list}>
          {items.map((item) => {
            const recommendation = RECOMMENDATIONS[item.key];
            return (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.checklistRow, pressed && !item.done && styles.buttonPressed]}
                onPress={() => open(recommendation.target)}
                disabled={item.done}
                accessibilityRole="button"
                accessibilityState={{ disabled: item.done, checked: item.done }}
              >
                <Ionicons
                  name={item.done ? 'checkmark-circle' : recommendation.icon}
                  size={24}
                  color={item.done ? colors.primary : colors.textSecondary}
                />
                <View style={styles.flex}>
                  <Text style={[styles.itemTitle, item.done && styles.checklistDone]}>{recommendation.title}</Text>
                </View>
                {!item.done && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
              </Pressable>
            );
          })}
          <Text style={[styles.textLink, styles.smallText]} onPress={hide} accessibilityRole="button">
            Ocultar por ahora
          </Text>
        </View>
      </Card>
    </Animated.View>
  );
}
