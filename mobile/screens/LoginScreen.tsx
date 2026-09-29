import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, ChoiceTile, Field, Illustration, Input, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import { ILLUSTRATIONS } from '../illustrations';
import { PASSWORD_RULE_TEXT, isValidPassword, openPrivacyNotice, openTerms } from '../utils';

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

// Al registrarse: casilla obligatoria de mayoría de edad y aceptación de
// los términos y el aviso (antes era solo un texto).
function ConsentCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <Pressable
      style={styles.consentRow}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      hitSlop={6}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={colors.primary} />
      <Text style={[styles.consentNote, styles.consentText, styles.flex]}>
        Tengo 18 años o más y acepto los{' '}
        <Text style={styles.textLink} onPress={() => void openTerms()} accessibilityRole="link">
          Términos y condiciones
        </Text>{' '}
        y el{' '}
        <Text style={styles.textLink} onPress={() => void openPrivacyNotice()} accessibilityRole="link">
          Aviso de privacidad
        </Text>
        .
      </Text>
    </Pressable>
  );
}

const FACEBOOK_BLUE = '#1877F2';
const PHONE_PATTERN = /^[0-9+()\-\s]{8,20}$/;

function AuthDivider() {
  return (
    <View style={styles.authDivider}>
      <View style={styles.authDividerLine} />
      <Text style={styles.smallText}>o</Text>
      <View style={styles.authDividerLine} />
    </View>
  );
}

function FacebookButton({ title, onPress, busy }: { title: string; onPress: () => void; busy: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.secondaryButton, (busy || pressed) && styles.primaryButtonBusy]}
      onPress={onPress}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
    >
      {busy ? (
        <ActivityIndicator />
      ) : (
        <View style={styles.socialButtonInner}>
          <Ionicons name="logo-facebook" size={22} color={FACEBOOK_BLUE} />
          <Text style={styles.secondaryButtonText}>{title}</Text>
        </View>
      )}
    </Pressable>
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
  onShowOnboarding,
  onForgotPassword,
  onResendConfirmation,
  onFacebookLogin,
  biometricName,
  onBiometricLogin,
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
  onShowOnboarding: () => void;
  onForgotPassword: (email: string) => void;
  onResendConfirmation: (email: string) => void;
  onFacebookLogin: (asMechanic: boolean) => void;
  /** Hay una sesión sellada con la huella (null si no): el nombre para "Entrar como…". */
  biometricName: string | null;
  onBiometricLogin: () => void;
}) {
  const { setMessage } = useAppContext();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  // Mecánico que eligió Facebook en "Tu cuenta": nombre y correo vienen de
  // Facebook, y el teléfono se pide en "Tu trabajo".
  const [mechanicViaFacebook, setMechanicViaFacebook] = useState(false);
  const hero = HERO_COPY[authMode];

  function passwordOk(password: string): boolean {
    if (!isValidPassword(password)) {
      setMessage(`Tu contraseña necesita ${PASSWORD_RULE_TEXT.toLowerCase()}.`);
      return false;
    }
    return true;
  }

  function submitSignup(password: string) {
    if (!passwordOk(password)) return;
    if (!consentOk()) return;
    onSubmit();
  }

  function consentOk(): boolean {
    if (!acceptedTerms) {
      setMessage('Para crear tu cuenta, confirma que tienes 18 años o más y aceptas los Términos.');
      return false;
    }
    return true;
  }

  function submitMechanicFacebook() {
    if (!PHONE_PATTERN.test(mechanicForm.phone.trim())) {
      setMessage('Escribe tu teléfono a 10 dígitos: con él te contactan tus clientes.');
      return;
    }
    const years = Number(mechanicForm.yearsExperience);
    if (
      mechanicForm.city.trim().length < 2 ||
      mechanicForm.zone.trim().length < 2 ||
      !mechanicForm.yearsExperience.trim() ||
      !Number.isInteger(years) ||
      years < 0 ||
      !mechanicForm.specialties.trim()
    ) {
      setMessage('Completa ciudad, zona, años de experiencia y especialidades.');
      return;
    }
    if (!consentOk()) return;
    onFacebookLogin(true);
  }
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
          <Card title="Inicia sesión" subtitle="Con tu correo y contraseña, o con Facebook.">
            <View style={styles.stack}>
              {biometricName !== null && (
                <>
                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, (busy || pressed) && styles.primaryButtonBusy]}
                    onPress={onBiometricLogin}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityState={{ busy, disabled: busy }}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <View style={styles.socialButtonInner}>
                        <Ionicons name="finger-print" size={24} color={colors.white} />
                        <Text style={styles.primaryButtonText}>
                          {biometricName ? `Entrar como ${biometricName}` : 'Entrar con huella'}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  <AuthDivider />
                </>
              )}
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
              <AuthDivider />
              <FacebookButton title="Entrar con Facebook" onPress={() => onFacebookLogin(false)} busy={busy} />
              <Text style={styles.consentNote}>
                Si es tu primera vez, se crea tu cuenta de cliente y aceptas los Términos y el Aviso de privacidad.
              </Text>
              <Text
                style={[styles.textLink, styles.forgotPasswordLink]}
                onPress={() => onForgotPassword(loginForm.email)}
                accessibilityRole="link"
              >
                ¿Olvidaste tu contraseña?
              </Text>
              <Text
                style={[styles.textLink, styles.forgotPasswordLink]}
                onPress={() => onResendConfirmation(loginForm.email)}
                accessibilityRole="link"
              >
                ¿No te llegó el correo de confirmación?
              </Text>
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
                      placeholder={PASSWORD_RULE_TEXT}
                    />
                  </Field>
                  <ConsentCheck checked={acceptedTerms} onToggle={() => setAcceptedTerms((value) => !value)} />
                  <PrimaryButton title="Crear cuenta" onPress={() => submitSignup(customerForm.password)} busy={busy} />
                  <AuthDivider />
                  <FacebookButton
                    title="Crear cuenta con Facebook"
                    onPress={() => {
                      if (consentOk()) onFacebookLogin(false);
                    }}
                    busy={busy}
                  />
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
                          placeholder={PASSWORD_RULE_TEXT}
                        />
                      </Field>
                      <PrimaryButton
                        title="Continuar"
                        onPress={() => {
                          if (!passwordOk(mechanicForm.password)) return;
                          setMechanicViaFacebook(false);
                          setMechanicSignupStep('work');
                        }}
                      />
                      <AuthDivider />
                      <FacebookButton
                        title="Continuar con Facebook"
                        onPress={() => {
                          setMechanicViaFacebook(true);
                          setMechanicSignupStep('work');
                        }}
                        busy={busy}
                      />
                    </>
                  ) : (
                    <>
                      {mechanicViaFacebook && (
                        <>
                          <Text style={styles.smallText}>Tu nombre y tu correo los tomamos de Facebook.</Text>
                          <Field label="Teléfono">
                            <Input
                              value={mechanicForm.phone}
                              keyboardType="phone-pad"
                              autoComplete="tel"
                              onChangeText={(value) => setMechanicForm({ ...mechanicForm, phone: value })}
                            />
                          </Field>
                        </>
                      )}
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
                      <SecondaryButton
                        title="Volver"
                        onPress={() => {
                          setMechanicViaFacebook(false);
                          setMechanicSignupStep('account');
                        }}
                      />
                      <ConsentCheck checked={acceptedTerms} onToggle={() => setAcceptedTerms((value) => !value)} />
                      {mechanicViaFacebook ? (
                        <FacebookButton title="Crear cuenta con Facebook" onPress={submitMechanicFacebook} busy={busy} />
                      ) : (
                        <PrimaryButton title="Crear cuenta" onPress={() => submitSignup(mechanicForm.password)} busy={busy} />
                      )}
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
        <Text style={styles.textLink} onPress={() => void openTerms()} accessibilityRole="link">
          Términos y condiciones
        </Text>
        {'  ·  '}
        <Text style={styles.textLink} onPress={() => void openPrivacyNotice()} accessibilityRole="link">
          Aviso de privacidad
        </Text>
      </Text>
    </View>
  );
}
