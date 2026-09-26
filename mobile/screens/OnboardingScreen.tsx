import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { styles } from '../styles';
import { ImagePlaceholder, PrimaryButton, SecondaryButton } from '../components/ui';

type OnboardingStep = {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
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
    <Animated.View key={currentStep} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.screenStack}>
      <View>
        {/* PLACEHOLDER: ilustración de marca para cada paso */}
        <ImagePlaceholder icon={step.icon} />
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.subtitle}>{step.body}</Text>
      </View>
      <View style={styles.onboardingDots}>
        {steps.map((_, index) => (
          <View key={index} style={[styles.onboardingDot, index === currentStep && styles.onboardingDotActive]} />
        ))}
      </View>
      <View style={styles.stack}>
        <PrimaryButton title={isLastStep ? 'Empezar' : 'Siguiente'} onPress={onNext} />
        {!isLastStep && <SecondaryButton title="Saltar" onPress={onSkip} />}
      </View>
    </Animated.View>
  );
}
