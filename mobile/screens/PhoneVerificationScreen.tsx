import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import { Card, Field, Illustration, Input, PrimaryButton, SecondaryButton } from '../components/ui';
import { ILLUSTRATIONS } from '../illustrations';
import { formatError } from '../utils';
import type { ApiCall } from '../App';

// Verificación por teléfono (servidor: src/phoneVerification.ts). Aparece al
// registrarse, al cambiar de número y al entrar desde un teléfono nuevo.

export type PhoneVerificationStatus = {
  required: boolean;
  reason: 'phone' | 'device' | null;
  needsPhoneNumber: boolean;
  phoneHint: string | null;
};

const RESEND_SECONDS = 30;

export function PhoneVerificationScreen({
  api,
  status,
  onVerified,
  onLogout,
}: {
  api: ApiCall;
  status: PhoneVerificationStatus;
  onVerified: (deviceId: string) => void;
  onLogout: () => void;
}) {
  const { busy, setBusy, setMessage } = useAppContext();
  const [editingPhone, setEditingPhone] = useState(status.needsPhoneNumber);
  const [phone, setPhone] = useState('');
  const [phoneHint, setPhoneHint] = useState(status.phoneHint);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function sendCode() {
    setBusy(true);
    try {
      const result = await api<{ phoneHint: string }>('/api/account/verification/send', {
        method: 'POST',
        body: editingPhone ? { phone } : {},
      });
      setPhoneHint(result.phoneHint);
      setEditingPhone(false);
      setCodeSent(true);
      setCode('');
      setResendIn(RESEND_SECONDS);
      setMessage(`Te mandamos un código por SMS al ${result.phoneHint}`);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!/^\d{4,8}$/.test(code.trim())) {
      setMessage('Escribe el código de 6 números que te llegó por SMS');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ deviceId: string }>('/api/account/verification/confirm', {
        method: 'POST',
        body: { code: code.trim() },
      });
      setMessage('Listo, tu teléfono quedó confirmado');
      onVerified(result.deviceId);
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  const isNewDevice = status.reason === 'device';

  return (
    <View style={styles.screenStack}>
      <Animated.View entering={FadeInDown.duration(300)} needsOffscreenAlphaCompositing>
        <Illustration source={ILLUSTRATIONS.identity} />
        <Text style={styles.title}>{isNewDevice ? 'Confirma que eres tú' : 'Confirma tu teléfono'}</Text>
        <Text style={styles.subtitle}>
          {isNewDevice
            ? 'Es la primera vez que entras desde este teléfono. Te mandamos un código por SMS para confirmarlo.'
            : 'Te mandamos un código por SMS para confirmar tu número. Así tu mecánico o tu cliente siempre pueden localizarte.'}
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).duration(300)} needsOffscreenAlphaCompositing>
        <Card
          title={codeSent ? 'Escribe el código' : editingPhone ? 'Tu número' : 'Te mandaremos un código'}
          subtitle={codeSent && phoneHint ? `Lo mandamos al ${phoneHint}.` : undefined}
        >
          <View style={styles.stack}>
            {editingPhone ? (
              <>
                <Field label="Número de celular (10 dígitos)">
                  <Input
                    value={phone}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    placeholder="449 123 4567"
                    onChangeText={setPhone}
                  />
                </Field>
                <PrimaryButton title="Mandarme el código" busy={busy} onPress={() => void sendCode()} />
                {!status.needsPhoneNumber && (
                  <SecondaryButton title="Cancelar" onPress={() => setEditingPhone(false)} />
                )}
              </>
            ) : codeSent ? (
              <>
                <Field label="Código de 6 números">
                  <Input
                    value={code}
                    keyboardType="number-pad"
                    autoComplete="sms-otp"
                    textContentType="oneTimeCode"
                    maxLength={8}
                    placeholder="123456"
                    onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
                  />
                </Field>
                <PrimaryButton title="Confirmar" busy={busy} onPress={() => void confirm()} />
                <SecondaryButton
                  title={resendIn > 0 ? `Reenviar código (${resendIn} s)` : 'Reenviar código'}
                  busy={busy}
                  onPress={() => {
                    if (resendIn <= 0) void sendCode();
                  }}
                />
                <SecondaryButton title="Cambiar número" onPress={() => { setEditingPhone(true); setCodeSent(false); }} />
              </>
            ) : (
              <>
                {phoneHint ? <Text style={styles.itemText}>Número: {phoneHint}</Text> : null}
                <PrimaryButton title="Mandarme el código" busy={busy} onPress={() => void sendCode()} />
                <SecondaryButton title="Usar otro número" onPress={() => setEditingPhone(true)} />
              </>
            )}
          </View>
        </Card>
      </Animated.View>

      <SecondaryButton title="Cerrar sesión" onPress={onLogout} />
    </View>
  );
}
