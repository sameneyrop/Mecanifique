import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

/**
 * Números que suben contando (de 0 al aparecer, o del valor anterior al nuevo
 * cuando cambian) y barras que crecen. Cortos, para que den vida sin hacer
 * esperar a nadie para leer la cifra.
 */

const COUNT_MS = 750;

export function useCountUp(value: number, duration = COUNT_MS): number {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(reduceMotion ? value : 0);
  const shownRef = useRef(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const start = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const next = t === 1 ? value : from + (value - from) * (1 - (1 - t) ** 3);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}

/** Texto con la cifra contando; sin estilo propio, hereda el del texto que lo rodea. */
export function CountUp({
  value,
  format = (amount) => String(amount),
  style,
}: {
  value: number;
  format?: (amount: number) => string;
  style?: StyleProp<TextStyle>;
}) {
  const shown = useCountUp(value);
  return <Text style={style}>{format(shown === value ? value : Math.round(shown))}</Text>;
}

/**
 * Crece desde abajo (barras) o desde la izquierda (rellenos horizontales) al
 * aparecer. `delay` escalona varias barras seguidas.
 */
export function GrowIn({
  direction,
  delay = 0,
  style,
  children,
}: {
  direction: 'up' | 'right';
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const grow = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!reduceMotion) grow.value = withDelay(delay, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
  }, []);
  const animatedStyle = useAnimatedStyle(() =>
    direction === 'up'
      ? { transformOrigin: 'bottom', transform: [{ scaleY: grow.value }] }
      : { transformOrigin: 'left', transform: [{ scaleX: grow.value }] },
  );
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
