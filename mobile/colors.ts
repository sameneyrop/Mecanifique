/**
 * Paleta de colores de marca de Mecanifique.
 * Un solo lugar para todos los colores de la app — evita tener hex sueltos
 * repetidos sin relación entre sí por todo App.tsx.
 */
export const colors = {
  primary: '#0072B2', // Azul de marca — botones, header, elementos activos
  primaryDark: '#00568a', // Azul oscuro — texto sobre fondo claro, estados hover/pressed
  primaryLight: '#e6f2f9', // Azul muy claro — fondos suaves (chips, bordes de tarjeta)
  primaryLighter: '#f2f8fc', // Azul aún más claro — fondos de tarjeta, fondo general

  textDark: '#0d2028', // Texto principal
  textSecondary: '#4a5d66', // Texto secundario / subtítulos

  accent: '#ffa500', // Acento — estrellas de calificación, destacados

  warningBg: '#fff8e0', // Fondo de avisos (ej. hint de verificación de identidad)

  white: '#ffffff',
} as const;