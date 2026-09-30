/**
 * Paletas de la app: la clara (la de la marca) y la oscura, sacada de los
 * azules marino de la misma marca. `colors` siempre devuelve la del tema
 * activo, así que hay que leerla al pintar, nunca guardarla en una constante
 * al cargar un módulo. styles.ts arma una hoja de estilos por tema. El tema
 * se cambia con applyThemePreference (theme.ts).
 */

const light = {
  bgTop: '#0B1F33',
  bgBottom: '#132A44',

  primary: '#2F8FEA',
  primaryDark: '#1C6DC4',
  primaryLight: '#D6E4F5',    // antes: rgba(255,255,255,0.16) — azul pálido sólido, visible sobre blanco
  primaryLighter: '#EEF3FA',  // antes: rgba(255,255,255,0.10) — azul casi blanco, para fondos sutiles de inputs/tarjetas
  bgApp: '#E3ECF8',           // fondo real de pantalla: sin esto, las tarjetas blancas se perdían contra un fondo también blanco
  // Fondo de tarjetas, barras y ventanas. Antes era `white`, que también es el
  // texto sobre los botones azules: en el tema oscuro son distintos.
  surface: '#ffffff',
  // Fondo oscuro con texto blanco encima (avisos, banner "¿Eres mecánico?").
  inverseSurface: '#0b0f22',

  textDark: '#0b0f22',       // vuelve al original: texto oscuro sobre fondo blanco
  textSecondary: '#4A5568',  // gris oscuro legible sobre blanco (antes #172531 era casi ilegible por bajo contraste)

  accent: '#F2B84B',
  warningBg: 'rgba(242,184,75,0.16)',
  white: '#ffffff',
  cardBg: '#122A42',
  cardAccentMechanic: '#F2B84B',

  // "Terminado", burbuja del mecánico en el chat y cajas de peligro.
  successBg: '#d9f3e4',
  successText: '#15803d',
  successBorder: '#92d6ad',
  dangerBorder: '#f5c2c2',

  isDark: false,
};

export type Palette = typeof light;
export type ColorScheme = 'light' | 'dark';

const dark: Palette = {
  bgTop: '#0B1F33',
  bgBottom: '#132A44',

  primary: '#2F8FEA',
  // Sobre fondo oscuro, los enlaces y textos azules van más claros.
  primaryDark: '#7DB8F2',
  primaryLight: '#28486B',
  primaryLighter: '#1A3552',
  bgApp: '#0B1F33',
  surface: '#132A44',
  inverseSurface: '#2A4A70',

  textDark: '#E8EFF7',
  textSecondary: '#A7B6C8',

  accent: '#F2B84B',
  warningBg: 'rgba(242,184,75,0.18)',
  white: '#ffffff',
  cardBg: '#0E2438',
  cardAccentMechanic: '#F2B84B',

  successBg: '#143D2A',
  successText: '#7EE2A8',
  successBorder: '#1F6B45',
  dangerBorder: '#6B3030',

  isDark: true,
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

let activeScheme: ColorScheme = 'light';

export function getActiveScheme(): ColorScheme {
  return activeScheme;
}

/** Solo theme.ts: cambia la paleta que devuelve `colors`. */
export function setActiveScheme(scheme: ColorScheme) {
  activeScheme = scheme;
}

export const colors: Palette = new Proxy(light, {
  get: (_target, key) => palettes[activeScheme][key as keyof Palette],
});
