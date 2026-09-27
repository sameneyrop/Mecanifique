import type { ImageSourcePropType } from 'react-native';

// Ilustraciones de marca (personaje azul). Todas viven aquí para poder
// cambiar cuál va en cada lugar sin buscar por las pantallas.
export const ILLUSTRATIONS = {
  homeHero: require('./assets/illust-home-hero.png'),
  search: require('./assets/illust-search.png'),
  waiting: require('./assets/illust-waiting.png'),
  identity: require('./assets/illust-identity.png'),
  firstRequest: require('./assets/illust-first-request.png'),
  newRequest: require('./assets/illust-new-request.png'),
  mechanicDashboard: require('./assets/illust-mechanic-dashboard.png'),
  settings: require('./assets/illust-settings.png'),
  error: require('./assets/illust-error.png'),
  emergency: require('./assets/illust-emergency.png'),
  completed: require('./assets/illust-completed.png'),
  profileReview: require('./assets/illust-profile-review.png'),
} satisfies Record<string, ImageSourcePropType>;
