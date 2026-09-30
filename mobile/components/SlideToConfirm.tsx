import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

import { colors } from '../colors';
import { fonts } from '../fonts';

/**
 * Deslizar para confirmar una acción que no se puede deshacer (terminar el
 * servicio): un toque accidental con el teléfono en la bolsa ya no la dispara.
 * La flecha se asoma de vez en cuando para invitar a deslizarla. Con lector
 * de pantalla se activa con doble toque.
 */

const HEIGHT = 64;
const PAD = 6;
const THUMB = HEIGHT - PAD * 2;
// Qué tanto hay que llevarla para que cuente.
const CONFIRM_AT = 0.85;
const RETURN = { duration: 280, easing: Easing.out(Easing.cubic) };

export function SlideToConfirm({
  label,
  hint,
  busy = false,
  onConfirm,
}: {
  label: string;
  /** Segunda línea, p. ej. cuánto se le va a cobrar al cliente. */
  hint?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const maxX = Math.max(0, width - THUMB - PAD * 2);
  const x = useSharedValue(0);
  const nudge = useSharedValue(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  // La flecha se asoma un poco cada pocos segundos mientras nadie la toca.
  function startNudge() {
    if (reduceMotion) return;
    nudge.value = withRepeat(
      withSequence(
        withDelay(2800, withTiming(8, { duration: 320, easing: Easing.inOut(Easing.quad) })),
        withTiming(0, { duration: 380, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }

  // De regreso a su lugar: directo y suave, sin rebote.
  function returnHome() {
    x.value = withTiming(0, RETURN);
    startNudge();
  }

  useEffect(() => {
    startNudge();
    return () => {
      cancelAnimation(nudge);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [reduceMotion]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Solo un arrastre horizontal: deslizar hacia arriba o abajo sigue
        // moviendo la pantalla.
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !busy && Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          cancelAnimation(nudge);
          nudge.value = withTiming(0, { duration: 100 });
          Haptics.selectionAsync().catch(() => undefined);
        },
        onPanResponderMove: (_, gesture) => {
          x.value = Math.min(maxX, Math.max(0, gesture.dx));
        },
        onPanResponderRelease: (_, gesture) => {
          if (maxX > 0 && gesture.dx >= maxX * CONFIRM_AT) {
            x.value = withTiming(maxX, { duration: 120 });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            confirmRef.current();
            // Si se canceló (p. ej. "cobrar menos"), vuelve a su lugar.
            resetTimer.current = setTimeout(returnHome, 1200);
          } else {
            returnHome();
          }
        },
        onPanResponderTerminate: returnHome,
      }),
    [maxX, busy, reduceMotion],
  );

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + nudge.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: x.value + nudge.value + THUMB + PAD * 2 }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: maxX > 0 ? interpolate(x.value, [0, maxX * 0.6], [1, 0], 'clamp') : 1,
  }));

  return (
    <View
      style={[sliderStyles.track, { backgroundColor: colors.primary }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityHint="Desliza la flecha a la derecha, o toca dos veces, para confirmar"
      accessibilityState={{ busy, disabled: busy }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate' && !busy) onConfirm();
      }}
      {...responder.panHandlers}
    >
      <Animated.View style={[sliderStyles.fill, fillStyle]} />
      <Animated.View style={[sliderStyles.labels, labelStyle]} pointerEvents="none">
        <Text style={[sliderStyles.label, { color: colors.white }]}>{label}</Text>
        {hint ? <Text style={[sliderStyles.hint, { color: colors.white }]}>{hint}</Text> : null}
      </Animated.View>
      <Animated.View style={[sliderStyles.thumb, { backgroundColor: colors.white }, thumbStyle]}>
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Ionicons name="arrow-forward" size={26} color={colors.primary} />
        )}
      </Animated.View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: 18,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Oscurece el azul por donde pasa la flecha (igual en los dos temas).
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: 'rgba(11, 15, 34, 0.22)',
  },
  labels: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: THUMB + PAD * 2,
    paddingRight: 12,
  },
  label: {
    fontFamily: fonts.extrabold,
    fontSize: 17,
  },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    opacity: 0.9,
    marginTop: 1,
  },
  thumb: {
    position: 'absolute',
    left: PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
