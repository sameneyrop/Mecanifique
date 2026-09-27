import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { Card, ChoiceTile, Field, Illustration, Input, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import { ILLUSTRATIONS } from '../illustrations';
import { openPrivacyNotice } from '../utils';

type AuthMode = 'login' | 'customer' | 'mechanic';
type MechanicSignupStep = 'account' | 'work';

type LoginForm = { email: string; password: string };
type CustomerForm = { fullName: string; email: string; phone: string; password: string };
type MechanicForm = {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  city: string;
  zone: string;
  yearsExperience: string;
  specialties: string;
  latitude: string;
  longitude: string;
};

// Sin mayúscula automática ni autocorrector: un correo "Sergio@..." o
// corregido por el teclado no inicia sesión.
const EMAIL_INPUT_PROPS = {
  autoCapitalize: 'none',
  autoCorrect: false,
  keyboardType: 'email-address',
  autoComplete: 'email',
  placeholder: 'correo@ejemplo.com',
} as const;

// Al registrarse: el aviso queda a la vista antes de crear la cuenta.
function PrivacyConsent() {
  return (
    <Text style={styles.consentNote}>
      Al crear tu cuenta aceptas el{' '}
      <Text style={styles.textLink} onPress={() => void openPrivacyNotice()} accessibilityRole="link">
        Aviso de privacidad
      </Text>
      .
    </Text>
  );
}

const HERO_COPY: Record<AuthMode, { title: string; subtitle: string }> = {
  login: {
    title: 'Qué gusto verte',
    subtitle: 'Entra para pedir un mecánico, seguir tu servicio o recibir solicitudes.',
  },
  customer: {
    title: 'Tu auto, en buenas manos',
    subtitle: 'Crea tu cuenta y encuentra mecánicos verificados cerca de ti.',
  },
  mechanic: {
    title: 'Más clientes, cerca de ti',
    subtitle: 'Crea tu cuenta de mecánico y recibe solicitudes en tu zona.',
  },
};

export function LoginScreen({
  authMode,
  setAuthMode,
  loginForm,
  setLoginForm,
  customerForm,
  setCustomerForm,
  mechanicForm,
  setMechanicForm,
  mechanicSignupStep,
  setMechanicSignupStep,
  busy,
  onSubmit,
  onGoogleLogin,
  onShowOnboarding,
}: {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  loginForm: LoginForm;
  setLoginForm: (form: LoginForm) => void;
  customerForm: CustomerForm;
  setCustomerForm: (form: CustomerForm) => void;
  mechanicForm: MechanicForm;
  setMechanicForm: (form: MechanicForm) => void;
  mechanicSignupStep: MechanicSignupStep;
  setMechanicSignupStep: (step: MechanicSignupStep) => void;
  busy: boolean;
  onSubmit: () => void;
  onGoogleLogin: () => void;
  onShowOnboarding: () => void;
}) {
  const hero = HERO_COPY[authMode];
  const signingUp = authMode !== 'login';

  return (
    <View style={styles.screenStack}>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Illustration source={authMode === 'mechanic' ? ILLUSTRATIONS.mechanicDashboard : ILLUSTRATIONS.homeHero} />
        <Text style={styles.title}>{hero.title}</Text>
        <Text style={styles.subtitle}>{hero.subtitle}</Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Segmented
          value={signingUp ? 'signup' : 'login'}
          onBackground
          options={[
            { key: 'login', label: 'Iniciar sesión', icon: 'log-in-outline' },
            { key: 'signup', label: 'Crear cuenta', icon: 'person-add-outline' },
          ]}
          onChange={(value) => setAuthMode(value === 'login' ? 'login' : signingUp ? authMode : 'customer')}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(300)} needsOffscreenAlphaCompositing>
        {authMode === 'login' && (
          <Card title="Inicia sesión" subtitle="Con el correo y la contraseña de tu cuenta.">
            <View style={styles.stack}>
              <Field label="Correo electrónico">
                <Input
                  {...EMAIL_INPUT_PROPS}
                  value={loginForm.email}
                  onChangeText={(value) => setLoginForm({ ...loginForm, email: value })}
                />
              </Field>
              <Field label="Contraseña">
                <Input
                  value={loginForm.password}
                  onChangeText={(value) => setLoginForm({ ...loginForm, password: value })}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </Field>
              <PrimaryButton title="Entrar" onPress={onSubmit} busy={busy} />
              <SecondaryButton title="Continuar con Google" onPress={onGoogleLogin} busy={busy} />
            </View>
          </Card>
        )}

        {signingUp && (
          <Card
            title="Crea tu cuenta"
            subtitle={
              authMode === 'mechanic'
                ? mechanicSignupStep === 'account'
                  ? 'Paso 1 de 2 · Tus datos de contacto.'
                  : 'Paso 2 de 2 · Dónde y en qué trabajas.'
                : '¿Cómo vas a usar Mecanifique?'
            }
          >
            <View style={styles.stack}>
              <View style={styles.row}>
                <ChoiceTile
                  icon="car-sport-outline"
                  title="Soy cliente"
                  description="Necesito un mecánico para mi auto."
                  active={authMode === 'customer'}
                  onPress={() => setAuthMode('customer')}
                  style={styles.flex}
                />
                <ChoiceTile
                  icon="construct-outline"
                  title="Soy mecánico"
                  description="Quiero recibir solicitudes."
                  active={authMode === 'mechanic'}
                  onPress={() => setAuthMode('mechanic')}
                  style={styles.flex}
                />
              </View>

              {authMode === 'customer' && (
                <>
                  <Field label="Nombre completo">
                    <Input
                      value={customerForm.fullName}
                      autoComplete="name"
                      onChangeText={(value) => setCustomerForm({ ...customerForm, fullName: value })}
                    />
                  </Field>
                  <Field label="Correo electrónico">
                    <Input
                      {...EMAIL_INPUT_PROPS}
                      value={customerForm.email}
                      onChangeText={(value) => setCustomerForm({ ...customerForm, email: value })}
                    />
                  </Field>
                  <Field label="Teléfono">
                    <Input
                      value={customerForm.phone}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      onChangeText={(value) => setCustomerForm({ ...customerForm, phone: value })}
                    />
                  </Field>
                  <Field label="Contraseña">
                    <Input
                      value={customerForm.password}
                      onChangeText={(value) => setCustomerForm({ ...customerForm, password: value })}
                      secureTextEntry
                      autoCapitalize="none"
                      placeholder="Mínimo 8 caracteres"
                    />
                  </Field>
                  <PrimaryButton title="Crear cuenta" onPress={onSubmit} busy={busy} />
                  <PrivacyConsent />
                </>
              )}

              {authMode === 'mechanic' && (
                <>
                  <Segmented
                    value={mechanicSignupStep}
                    options={[
                      { key: 'account', label: 'Tu cuenta', icon: 'person-outline' },
                      { key: 'work', label: 'Tu trabajo', icon: 'construct-outline' },
                    ]}
                    onChange={(value) => setMechanicSignupStep(value as MechanicSignupStep)}
                  />
                  {mechanicSignupStep === 'account' ? (
                    <>
                      <Field label="Nombre completo">
                        <Input
                          value={mechanicForm.fullName}
                          autoComplete="name"
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, fullName: value })}
                        />
                      </Field>
                      <Field label="Correo electrónico">
                        <Input
                          {...EMAIL_INPUT_PROPS}
                          value={mechanicForm.email}
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, email: value })}
                        />
                      </Field>
                      <Field label="Teléfono">
                        <Input
                          value={mechanicForm.phone}
                          keyboardType="phone-pad"
                          autoComplete="tel"
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, phone: value })}
                        />
                      </Field>
                      <Field label="Contraseña">
                        <Input
                          value={mechanicForm.password}
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, password: value })}
                          secureTextEntry
                          autoCapitalize="none"
                          placeholder="Mínimo 8 caracteres"
                        />
                      </Field>
                      <PrimaryButton title="Continuar" onPress={() => setMechanicSignupStep('work')} />
                    </>
                  ) : (
                    <>
                      <View style={styles.row}>
                        <Field label="Ciudad" style={styles.flex}>
                          <Input value={mechanicForm.city} onChangeText={(value) => setMechanicForm({ ...mechanicForm, city: value })} />
                        </Field>
                        <Field label="Zona" style={styles.flex}>
                          <Input value={mechanicForm.zone} onChangeText={(value) => setMechanicForm({ ...mechanicForm, zone: value })} />
                        </Field>
                      </View>
                      <Field label="Años de experiencia">
                        <Input
                          value={mechanicForm.yearsExperience}
                          keyboardType="numeric"
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, yearsExperience: value })}
                        />
                      </Field>
                      <Field label="Especialidades (separadas por coma)">
                        <Input
                          value={mechanicForm.specialties}
                          placeholder="Motor, Frenos, Eléctrico"
                          onChangeText={(value) => setMechanicForm({ ...mechanicForm, specialties: value })}
                        />
                      </Field>
                      <Text style={styles.smallText}>Tu ubicación se toma sola al abrir la app.</Text>
                      <SecondaryButton title="Volver" onPress={() => setMechanicSignupStep('account')} />
                      <PrimaryButton title="Crear cuenta" onPress={onSubmit} busy={busy} />
                      <PrivacyConsent />
                    </>
                  )}
                </>
              )}
            </View>
          </Card>
        )}
      </Animated.View>

      <SecondaryButton title="Ver introducción" onPress={onShowOnboarding} />
      <Text style={styles.consentNote}>
        <Text style={styles.textLink} onPress={() => void openPrivacyNotice()} accessibilityRole="link">
          Aviso de privacidad
        </Text>
      </Text>
    </View>
  );
}
