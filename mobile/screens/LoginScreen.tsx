import { Image, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { Card, Field, Input, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';

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

const APP_LOGO_IMAGE = require('../assets/logo.png');

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
  return (
    <Animated.View entering={FadeInDown.duration(280)}>
      <Image source={APP_LOGO_IMAGE} resizeMode="contain" style={styles.logoWordmark} accessibilityLabel="Mecanifique" />
      <Text style={styles.title}>Inicia sesión</Text>
      <Text style={styles.subtitle}>Accede para ver mapa, solicitudes y mecánicos.</Text>
      <Card title="Sesión" subtitle="Inicia sesión o regístrate">
        <Segmented
          value={authMode}
          options={[
            { key: 'login', label: 'Login' },
            { key: 'customer', label: 'Cliente' },
            { key: 'mechanic', label: 'Mecánico' },
          ]}
          onChange={(value) => setAuthMode(value as AuthMode)}
        />
        {authMode === 'login' && (
          <View style={styles.stack}>
            <Field label="Email">
              <Input value={loginForm.email} onChangeText={(value) => setLoginForm({ ...loginForm, email: value })} />
            </Field>
            <Field label="Contraseña">
              <Input
                value={loginForm.password}
                onChangeText={(value) => setLoginForm({ ...loginForm, password: value })}
                secureTextEntry
              />
            </Field>
          </View>
        )}
        {authMode === 'customer' && (
          <View style={styles.stack}>
            <Field label="Nombre completo">
              <Input
                value={customerForm.fullName}
                onChangeText={(value) => setCustomerForm({ ...customerForm, fullName: value })}
              />
            </Field>
            <Field label="Email">
              <Input
                value={customerForm.email}
                onChangeText={(value) => setCustomerForm({ ...customerForm, email: value })}
                placeholder="correo@ejemplo.com"
              />
            </Field>
            <Field label="Teléfono">
              <Input value={customerForm.phone} onChangeText={(value) => setCustomerForm({ ...customerForm, phone: value })} />
            </Field>
            <Field label="Contraseña">
              <Input
                value={customerForm.password}
                onChangeText={(value) => setCustomerForm({ ...customerForm, password: value })}
                secureTextEntry
              />
            </Field>
          </View>
        )}
        {authMode === 'mechanic' && (
          <View style={styles.stack}>
            <Segmented
              value={mechanicSignupStep}
              options={[
                { key: 'account', label: 'Cuenta' },
                { key: 'work', label: 'Trabajo' },
              ]}
              onChange={(value) => setMechanicSignupStep(value as MechanicSignupStep)}
            />
            {mechanicSignupStep === 'account' ? (
              <View style={styles.stack}>
                <Field label="Nombre completo">
                  <Input
                    value={mechanicForm.fullName}
                    onChangeText={(value) => setMechanicForm({ ...mechanicForm, fullName: value })}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    value={mechanicForm.email}
                    onChangeText={(value) => setMechanicForm({ ...mechanicForm, email: value })}
                    placeholder="correo@ejemplo.com"
                  />
                </Field>
                <Field label="Teléfono">
                  <Input value={mechanicForm.phone} onChangeText={(value) => setMechanicForm({ ...mechanicForm, phone: value })} />
                </Field>
                <Field label="Contraseña">
                  <Input
                    value={mechanicForm.password}
                    onChangeText={(value) => setMechanicForm({ ...mechanicForm, password: value })}
                    secureTextEntry
                  />
                </Field>
                <SecondaryButton title="Continuar" onPress={() => setMechanicSignupStep('work')} />
              </View>
            ) : (
              <View style={styles.stack}>
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
                <Field label="Especialidades (coma)">
                  <Input
                    value={mechanicForm.specialties}
                    onChangeText={(value) => setMechanicForm({ ...mechanicForm, specialties: value })}
                  />
                </Field>
                <Text style={styles.smallText}>La ubicación se obtiene automáticamente al abrir la app.</Text>
                <SecondaryButton title="Volver" onPress={() => setMechanicSignupStep('account')} />
              </View>
            )}
          </View>
        )}
        <PrimaryButton title={authMode === 'login' ? 'Entrar' : 'Crear cuenta'} onPress={onSubmit} busy={busy} />
        {authMode === 'login' && <SecondaryButton title="Continuar con Google" onPress={onGoogleLogin} busy={busy} />}
      </Card>
      <SecondaryButton title="Ver introducción" onPress={onShowOnboarding} />
    </Animated.View>
  );
}
