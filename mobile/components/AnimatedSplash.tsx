import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';

import { fonts } from '../fonts';

// Pantalla de carga animada. El logo es idéntico al de la nativa (app.json →
// expo-splash-screen: fondo #0072B2 y el logo blanco de 180 de ancho al
// centro) y no se mueve ni se altera, así que el cambio de una a otra no se
// nota. Encima aparece el coche del ícono de la app sobre un elevador de
// taller que lo sube y lo baja mientras la app revisa la sesión; al terminar
// el elevador baja y la pantalla se desvanece.

const BRAND_BLUE = '#0072B2';
// Blanco al 60 % y al 35 % sobre el azul, en sólido para que las piezas del
// elevador no se encimen como transparencias.
const LIFT_COLOR = '#99C7E0';
const FLOOR_COLOR = '#59A3CD';
const LOGO = require('../assets/splash-logo.png');
const LOGO_WIDTH = 180;
const LOGO_HEIGHT = (76 * LOGO_WIDTH) / 532;
// La silueta del ícono (assets/android-icon-monochrome.png recortada, 520x160).
const CAR = require('../assets/splash-car.png');
const CAR_WIDTH = 84;
const CAR_HEIGHT = (160 * CAR_WIDTH) / 520;
// El coche se apoya en el estribo (columnas 164-377, base en la fila 153).
const CAR_SILL = (154 * CAR_WIDTH) / 520;
const SILL_OFFSET = ((164 + 378) / 2 - 260) * (CAR_WIDTH / 520);
// Posiciones relativas al borde superior del logo (negativas hacia arriba).
const FLOOR_TOP = -16;
const FLOOR_WIDTH = 120;
const CYLINDER_WIDTH = 10;
const CYLINDER_TOP = FLOOR_TOP - 8;
const ROD_WIDTH = 4;
const PLATFORM_WIDTH = 32;
const PLATFORM_TOP = CYLINDER_TOP - 3;
const CAR_TOP = PLATFORM_TOP - CAR_SILL;
// Lo que sube el coche.
const LIFT = 14;
const APPEAR_MS = 300;
// Aunque cargue rápido, se ve un momento (si no, parpadea).
const MIN_VISIBLE_MS = 1400;
// Si tarda, se explica (el servidor gratis a veces tarda en despertar).
const SLOW_NOTICE_MS = 6000;

export function AnimatedSplash({ ready, onFinish }: { ready: boolean; onFinish: () => void }) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [minTimeDone, setMinTimeDone] = useState(false);
  const [slow, setSlow] = useState(false);
  const appear = useSharedValue(reduceMotion ? 1 : 0);
  // 0 = abajo, 1 = arriba.
  const lift = useSharedValue(0);
  const fade = useSharedValue(0);
  const liftX = width / 2 + SILL_OFFSET;

  useEffect(() => {
    // La nativa se quita en cuanto esta ya está en pantalla.
    SplashScreen.hideAsync().catch(() => undefined);
    if (!reduceMotion) {
      appear.value = withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) });
      // Sube, se sostiene, baja y vuelve a empezar.
      lift.value = withDelay(
        APPEAR_MS,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 650, easing: Easing.inOut(Easing.cubic) }),
            withTiming(1, { duration: 450 }),
            withTiming(0, { duration: 650, easing: Easing.inOut(Easing.cubic) }),
            withTiming(0, { duration: 350 }),
          ),
          -1,
          false,
        ),
      );
    }
    const minTimer = setTimeout(() => setMinTimeDone(true), MIN_VISIBLE_MS);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(slowTimer);
      cancelAnimation(appear);
      cancelAnimation(lift);
      cancelAnimation(fade);
    };
  }, []);

  useEffect(() => {
    if (!ready || !minTimeDone) return;
    const fadeOut = () => {
      'worklet';
      fade.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      });
    };
    // El elevador baja desde donde vaya y luego se desvanece todo.
    cancelAnimation(lift);
    lift.value = withTiming(
      0,
      { duration: Math.max(150, 500 * lift.value), easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (finished) fadeOut();
      },
    );
  }, [ready, minTimeDone]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));
  const liftGroupStyle = useAnimatedStyle(() => ({ opacity: appear.value }));
  const raisedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -LIFT * lift.value }] }));
  const rodStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: lift.value }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, splashStyles.container, containerStyle]} pointerEvents="none">
      <View style={splashStyles.stage} accessible accessibilityLabel="Mecanifique, cargando">
        <Image source={LOGO} style={splashStyles.logo} resizeMode="contain" />
        <Animated.View style={[StyleSheet.absoluteFill, liftGroupStyle]}>
          <View style={[splashStyles.floor, { left: (width - FLOOR_WIDTH) / 2 }]} />
          <Animated.View style={[splashStyles.rod, { left: liftX - ROD_WIDTH / 2 }, rodStyle]} />
          <View style={[splashStyles.cylinder, { left: liftX - CYLINDER_WIDTH / 2 }]} />
          <Animated.View style={[splashStyles.platform, { left: liftX - PLATFORM_WIDTH / 2 }, raisedStyle]} />
          <Animated.Image
            source={CAR}
            style={[splashStyles.car, { left: (width - CAR_WIDTH) / 2 }, raisedStyle]}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
      {slow && <Text style={splashStyles.slowText}>Conectando… la primera vez puede tardar hasta un minuto.</Text>}
    </Animated.View>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    backgroundColor: BRAND_BLUE,
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  // Del alto del logo, para que quede justo al centro como en la nativa.
  stage: {
    width: '100%',
    height: LOGO_HEIGHT,
    alignItems: 'center',
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
  },
  floor: {
    position: 'absolute',
    top: FLOOR_TOP,
    width: FLOOR_WIDTH,
    height: 2,
    borderRadius: 1,
    backgroundColor: FLOOR_COLOR,
  },
  cylinder: {
    position: 'absolute',
    top: CYLINDER_TOP,
    width: CYLINDER_WIDTH,
    height: FLOOR_TOP - CYLINDER_TOP,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: LIFT_COLOR,
  },
  // El pistón: crece desde el cilindro hasta el brazo.
  rod: {
    position: 'absolute',
    top: CYLINDER_TOP - LIFT,
    width: ROD_WIDTH,
    height: LIFT,
    transformOrigin: 'bottom',
    backgroundColor: LIFT_COLOR,
  },
  platform: {
    position: 'absolute',
    top: PLATFORM_TOP,
    width: PLATFORM_WIDTH,
    height: CYLINDER_TOP - PLATFORM_TOP,
    borderRadius: 1.5,
    backgroundColor: LIFT_COLOR,
  },
  car: {
    position: 'absolute',
    top: CAR_TOP,
    width: CAR_WIDTH,
    height: CAR_HEIGHT,
  },
  slowText: {
    position: 'absolute',
    bottom: 64,
    left: 32,
    right: 32,
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.85)',
    fontFamily: fonts.medium,
    fontSize: 14,
  },
});
