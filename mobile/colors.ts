export const colors = {
  bgTop: '#0B1F33',
  bgBottom: '#132A44',

  primary: '#2F8FEA',
  primaryDark: '#1C6DC4',
  primaryLight: '#D6E4F5',    // antes: rgba(255,255,255,0.16) — azul pálido sólido, visible sobre blanco
  primaryLighter: '#EEF3FA',  // antes: rgba(255,255,255,0.10) — azul casi blanco, para fondos sutiles de inputs/tarjetas

  textDark: '#0b0f22',       // vuelve al original: texto oscuro sobre fondo blanco
  textSecondary: '#4A5568',  // gris oscuro legible sobre blanco (antes #172531 era casi ilegible por bajo contraste)

  accent: '#F2B84B',
  warningBg: 'rgba(242,184,75,0.16)',
  white: '#ffffff',
  cardBg: '#122A42',
  cardAccentMechanic: '#F2B84B',
} as const;