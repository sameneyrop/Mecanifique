import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { colors } from '../colors';
import { styles } from '../styles';
import { PrimaryButton, SecondaryButton } from '../components/ui';

type OnboardingStep = {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  image?: number;
};

export function OnboardingScreen({
  steps,
  currentStep,
  onNext,
  onSkip,
}: {
  steps: readonly OnboardingStep[];
  currentStep: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <Animated.View key={currentStep} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)}>
      {step.image ? (
        <Image source={step.image} resizeMode="contain" style={styles.onboardingImage} />
      ) : (
        <View style={styles.onboardingIconWrap}>
          <Ionicons name={step.icon} size={42} color={colors.primary} />
        </View>
      )}
      <Text style={styles.title}>{step.title}</Text>
      <Text style={styles.subtitle}>{step.body}</Text>
      <View style={styles.onboardingDots}>
        {steps.map((_, index) => (
          <View key={index} style={[styles.onboardingDot, index === currentStep && styles.onboardingDotActive]} />
        ))}
      </View>
      <PrimaryButton title={isLastStep ? 'Empezar' : 'Siguiente'} onPress={onNext} />
      <SecondaryButton title="Saltar" onPress={onSkip} />
    </Animated.View>
  );
}
