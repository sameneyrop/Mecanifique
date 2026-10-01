import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { PrimaryButton } from './ui';

/**
 * Recorrido de la app la primera vez que se entra con cada rol (cliente y
 * mecánico; quien cambia de modo ve el del otro rol la primera vez). Cambia
 * de pantalla solo, oscurece todo menos el botón que explica y lo señala con
 * un marco. Se puede saltar y volver a ver desde Cuenta (cliente) o Acciones
 * (mecánico).
 *
 * Los elementos que señala se envuelven en <TourTarget id="...">; si uno no
 * está en pantalla (p. ej. no se alcanzó a mostrar), el paso sale centrado.
 */

export type TourScreen = 'home' | 'requests' | 'mechanics' | 'map' | 'actions' | 'account';
type IconName = ComponentProps<typeof Ionicons>['name'];

type TourStep = {
  title: string;
  text: string;
  /** Pantalla que se abre antes de mostrar el paso. */
  screen?: TourScreen;
  /** Elemento que se señala (TourTarget). Sin él, el paso sale centrado con un ícono. */
  target?: string;
  /** El elemento está dentro del contenido (no en la barra de abajo ni arriba): se desplaza para verlo. */
  inContent?: boolean;
  icon?: IconName;
};

const CUSTOMER_STEPS: TourStep[] = [
  {
    screen: 'home',
    icon: 'sparkles-outline',
    title: 'Bienvenido a Mecanifique',
    text: 'Te enseñamos la app en un minuto. Puedes saltarte el recorrido cuando quieras y volver a verlo en Cuenta.',
  },
  {
    screen: 'home',
    target: 'home-search',
    inContent: true,
    title: 'Pide un mecánico',
    text: 'Escribe tu ciudad y zona o usa tu ubicación. «Ahora mismo» le avisa al mecánico más cercano; «Agendar fecha» te deja escoger uno y su horario.',
  },
  {
    screen: 'mechanics',
    target: 'nav-mechanics',
    title: 'Conoce a los mecánicos',
    text: 'Aquí ves a los mecánicos cerca de ti con su foto, calificación, reseñas y precio de visita. Guarda tus favoritos o pídele directo a uno.',
  },
  {
    screen: 'requests',
    target: 'nav-requests',
    title: 'Tus solicitudes',
    text: 'Sigue cada servicio: cuándo lo aceptan, por dónde viene el mecánico, la cotización para que la apruebes, los tickets de refacciones y el pago.',
  },
  {
    icon: 'construct-outline',
    title: 'Así funciona un servicio',
    text: '1. El mecánico acepta y va a donde está tu auto.\n2. Lo revisa y te manda una cotización.\n3. Solo repara si tú la apruebas.\n4. Al terminar le pagas directo a él y lo calificas.',
  },
  {
    target: 'bell',
    title: 'Avisos',
    text: 'Aquí te avisamos cuando te acepten, cuando el mecánico vaya en camino o llegue y cuando te mande una cotización.',
  },
  {
    screen: 'account',
    target: 'nav-account',
    title: 'Tu cuenta',
    text: 'Tus vehículos, tus datos, tus mecánicos favoritos, seguridad y ayuda. Aquí también puedes volver a ver este recorrido.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Tu seguridad',
    text: 'Cuando te acepten verás la foto del mecánico: revisa que sea quien llega. Durante un servicio tienes un botón de emergencia que llama al 911.',
  },
  {
    screen: 'home',
    icon: 'checkmark-circle-outline',
    title: '¡Listo!',
    text: 'Ya sabes lo básico. Cuando lo necesites, pide tu mecánico desde Inicio.',
  },
];

const MECHANIC_STEPS: TourStep[] = [
  {
    screen: 'home',
    icon: 'sparkles-outline',
    title: 'Bienvenido a Mecanifique',
    text: 'Te enseñamos cómo recibir y hacer trabajos en un minuto. Puedes saltarte el recorrido y volver a verlo en Acciones.',
  },
  {
    screen: 'home',
    target: 'mechanic-status',
    inContent: true,
    title: 'Conéctate para recibir trabajo',
    text: 'Con «Conectarme» te llegan solicitudes de clientes cerca de ti. Desconéctate al terminar tu día. Antes, completa los pasos de «Activa tu cuenta».',
  },
  {
    icon: 'notifications-outline',
    title: 'Cuando llega una solicitud',
    text: 'Te sale en pantalla con el auto, el problema y la distancia. Tienes 2 minutos para aceptarla; si no, pasa a otro mecánico.',
  },
  {
    screen: 'requests',
    target: 'nav-requests',
    title: 'Tus trabajos',
    text: 'Aquí están tus trabajos en curso y los agendados, con los datos del cliente y el chat.',
  },
  {
    icon: 'construct-outline',
    title: 'Así haces un servicio',
    text: '1. Toca «Voy en camino» y se abre la ruta.\n2. Al llegar, revisa el auto y manda tu cotización con su garantía.\n3. Cuando el cliente la apruebe, toma la foto de antes y repara.\n4. Si compras refacciones, tómale foto al ticket.\n5. Toma la foto de cómo quedó, ofrécele las piezas cambiadas y cobra directo al cliente.',
  },
  {
    screen: 'map',
    target: 'nav-map',
    title: 'Mapa',
    text: 'Las solicitudes que te llegan y el trabajo en curso, con el botón «Cómo llegar».',
  },
  {
    screen: 'actions',
    target: 'nav-actions',
    title: 'Acciones',
    text: 'Tu perfil público (foto, precio de visita y fotos de tu trabajo), tu agenda de horarios, tus promociones y tus comisiones.',
  },
  {
    icon: 'receipt-outline',
    title: 'Comisión de Mecanifique',
    text: 'El cliente te paga todo a ti. Mecanifique cobra 10 % de la visita y la mano de obra (no de las refacciones): mínimo $30 y máximo $300 por servicio. En tus primeros 30 días, contados desde tu primer servicio, no pagas nada. Cada lunes llega tu corte y tienes 7 días para pagarlo.',
  },
  {
    screen: 'home',
    icon: 'checkmark-circle-outline',
    title: '¡Listo!',
    text: 'Completa los pasos de «Activa tu cuenta» y conéctate para empezar a recibir solicitudes.',
  },
];

// --- Elementos señalables ---------------------------------------------------

const targets = new Map<string, View>();

export function TourTarget({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) targets.set(id, node);
    return () => {
      if (node && targets.get(id) === node) targets.delete(id);
    };
  }, [id]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}

type Rect = { x: number; y: number; width: number; height: number };

function measure(node: View): Promise<Rect | null> {
  return new Promise((resolve) => {
    node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Recorrido ---------------------------------------------------------------

const HIGHLIGHT_PADDING = 6;
// Barra de navegación de abajo: lo que queda detrás de ella no se ve.
const BOTTOM_NAV_SPACE = 110;

export function AppTour({
  role,
  visible,
  onNavigate,
  onScrollBy,
  onFinish,
}: {
  role: 'customer' | 'mechanic';
  visible: boolean;
  onNavigate: (screen: TourScreen) => void;
  /** Desplaza la pantalla principal para que el elemento señalado quede a la vista. */
  onScrollBy: (dy: number) => void;
  onFinish: () => void;
}) {
  const steps = role === 'mechanic' ? MECHANIC_STEPS : CUSTOMER_STEPS;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  // Alto real de la capa (en Android puede cubrir también la barra de estado).
  const [overlayHeight, setOverlayHeight] = useState(windowHeight);
  const [cardHeight, setCardHeight] = useState(240);
  const overlayRef = useRef<View>(null);
  const runId = useRef(0);
  // En refs: si cambian en cada render de App, el paso no se vuelve a buscar.
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const scrollByRef = useRef(onScrollBy);
  scrollByRef.current = onScrollBy;

  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  const step = steps[index];

  const locate = useCallback(async (current: TourStep) => {
    const run = ++runId.current;
    setReady(false);
    setRect(null);
    if (current.screen) {
      navigateRef.current(current.screen);
      // La pantalla nueva entra con una animación corta.
      await wait(550);
    }
    if (run !== runId.current) return;
    const node = current.target ? targets.get(current.target) : undefined;
    let found = node ? await measure(node) : null;
    // Lo que está dentro del contenido puede quedar fuera de la vista o detrás
    // de la barra de abajo: se desplaza para mostrarlo. (La barra y la campana
    // siempre se ven; desplazar ahí movía la pantalla sin razón.)
    if (current.inContent && node && found && found.y + found.height > windowHeight - BOTTOM_NAV_SPACE) {
      scrollByRef.current(found.y - windowHeight * 0.3);
      await wait(400);
      found = await measure(node);
    }
    // Capa y elemento se miden en la misma ventana; se resta el origen de la
    // capa por si no empieza en el borde de arriba (barra de estado).
    const origin = overlayRef.current ? await measure(overlayRef.current) : null;
    if (run !== runId.current) return;
    setRect(found && origin ? { ...found, x: found.x - origin.x, y: found.y - origin.y } : found);
    setReady(true);
  }, [windowHeight]);

  useEffect(() => {
    if (visible && step) void locate(step);
  }, [visible, step, locate]);

  // El botón "atrás" de Android cierra el recorrido (como Saltar).
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      finishRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [visible]);

  if (!visible || !step) {
    return null;
  }

  const isLast = index === steps.length - 1;
  const next = () => (isLast ? onFinish() : setIndex((value) => value + 1));
  const back = () => setIndex((value) => Math.max(0, value - 1));

  const highlight = rect
    ? {
        x: rect.x - HIGHLIGHT_PADDING,
        y: rect.y - HIGHLIGHT_PADDING,
        width: rect.width + HIGHLIGHT_PADDING * 2,
        height: rect.height + HIGHLIGHT_PADDING * 2,
      }
    : null;
  // La tarjeta va del lado donde hay más espacio, sin salirse de la pantalla:
  // entre la barra de estado y la de navegación de cada teléfono. Con la letra
  // del teléfono en grande puede no caber; entonces su texto se desplaza por
  // dentro y los botones siguen a la vista.
  const cardWidth = Math.min(windowWidth - 32, 420);
  const topLimit = insets.top + 12;
  const bottomLimit = overlayHeight - insets.bottom - 12;
  const maxCardHeight = Math.max(200, bottomLimit - topLimit);
  const shownCardHeight = Math.min(cardHeight, maxCardHeight);
  let cardTop = overlayHeight * 0.26;
  if (highlight) {
    const below = highlight.y + highlight.height / 2 < overlayHeight / 2;
    cardTop = below ? highlight.y + highlight.height + 14 : highlight.y - 14 - shownCardHeight;
  }
  cardTop = Math.max(topLimit, Math.min(cardTop, bottomLimit - shownCardHeight));

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.tourLayer}>
      {/* Sin Modal: un Modal de Android es otra ventana que empieza en la barra
          de estado, y el marco quedaba más arriba que el botón. La capa toma
          todos los toques para que no se pique nada detrás durante el recorrido. */}
      <View
        ref={overlayRef}
        collapsable={false}
        style={styles.tourOverlay}
        onLayout={(event) => setOverlayHeight(event.nativeEvent.layout.height)}
        onStartShouldSetResponder={() => true}
      >
        {highlight ? (
          <>
            <View style={[styles.tourDim, { top: 0, left: 0, right: 0, height: Math.max(0, highlight.y) }]} />
            <View style={[styles.tourDim, { top: highlight.y + highlight.height, left: 0, right: 0, bottom: 0 }]} />
            <View style={[styles.tourDim, { top: highlight.y, left: 0, width: Math.max(0, highlight.x), height: highlight.height }]} />
            <View
              style={[
                styles.tourDim,
                { top: highlight.y, left: highlight.x + highlight.width, right: 0, height: highlight.height },
              ]}
            />
            <View
              pointerEvents="none"
              style={[styles.tourRing, { top: highlight.y, left: highlight.x, width: highlight.width, height: highlight.height }]}
            />
          </>
        ) : (
          <View style={[styles.tourDim, { top: 0, left: 0, right: 0, bottom: 0 }]} />
        )}

        {ready && (
          <Animated.View
            key={index}
            entering={FadeIn.duration(200)}
            style={[
              styles.tourCard,
              { width: cardWidth, left: (windowWidth - cardWidth) / 2, top: cardTop, maxHeight: maxCardHeight },
            ]}
            onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
          >
            <ScrollView style={styles.tourBody} contentContainerStyle={styles.tourBodyContent} bounces={false}>
              {!highlight && step.icon ? (
                <View style={styles.tourIcon}>
                  <Ionicons name={step.icon} size={28} color={colors.primary} />
                </View>
              ) : null}
              <Text style={styles.tourCounter} maxFontSizeMultiplier={1.6}>
                {index + 1} de {steps.length}
              </Text>
              <Text style={styles.tourTitle} maxFontSizeMultiplier={1.6}>
                {step.title}
              </Text>
              <Text style={styles.tourText} maxFontSizeMultiplier={1.6}>
                {step.text}
              </Text>
            </ScrollView>
            <View style={styles.tourActions}>
              {!isLast ? (
                <Pressable onPress={onFinish} hitSlop={10} accessibilityRole="button">
                  <Text style={styles.tourSkip} maxFontSizeMultiplier={1.6}>
                    Saltar
                  </Text>
                </Pressable>
              ) : (
                <View />
              )}
              <View style={styles.tourButtons}>
                {index > 0 && (
                  <Pressable onPress={back} hitSlop={10} accessibilityRole="button">
                    <Text style={styles.tourBack} maxFontSizeMultiplier={1.6}>
                      Atrás
                    </Text>
                  </Pressable>
                )}
                <View style={styles.tourNext}>
                  <PrimaryButton title={isLast ? 'Empezar' : index === 0 ? 'Ver recorrido' : 'Siguiente'} onPress={next} />
                </View>
              </View>
            </View>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}
