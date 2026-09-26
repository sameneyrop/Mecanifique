import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '../colors';
import { styles } from '../styles';
import { useAppContext } from '../context/AppContext';
import {
  Card,
  CharCounter,
  ChoiceTile,
  EmptyState,
  Field,
  InfoRow,
  Input,
  PrimaryButton,
  SecondaryButton,
  Segmented,
} from '../components/ui';
import { formatError, formatServerDate } from '../utils';
import type { ApiCall } from '../App';

export type CommunityView = { mode: 'list' } | { mode: 'new' } | { mode: 'detail'; questionId: number };

type Category = 'frenos' | 'suspension' | 'transmision' | 'motor' | 'electrico' | 'llantas' | 'otro';

const CATEGORIES: Array<{ key: Category; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'frenos', label: 'Frenos', icon: 'disc-outline' },
  { key: 'suspension', label: 'Suspensión', icon: 'git-commit-outline' },
  { key: 'transmision', label: 'Transmisión', icon: 'cog-outline' },
  { key: 'motor', label: 'Motor', icon: 'speedometer-outline' },
  { key: 'electrico', label: 'Eléctrico', icon: 'flash-outline' },
  { key: 'llantas', label: 'Llantas', icon: 'ellipse-outline' },
  { key: 'otro', label: 'Otro', icon: 'help-circle-outline' },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((category) => [category.key, category.label])) as Record<string, string>;

type Question = {
  id: number;
  title: string;
  body: string;
  category: Category;
  vehicleLabel: string | null;
  createdAt: string;
  authorName: string;
  isMine: boolean;
  answerCount: number;
  followerCount: number;
  followedByMe: boolean;
};

type Answer = {
  id: number;
  body: string;
  createdAt: string;
  mechanicId: number;
  mechanicName: string;
  mechanicVerified: boolean;
  rating: number;
  jobsCompleted: number;
  helpfulCount: number;
  helpfulByMe: boolean;
  isMine: boolean;
};

function CategoryChips({
  value,
  onChange,
  includeAll,
}: {
  value: Category | null;
  onChange: (category: Category | null) => void;
  includeAll: boolean;
}) {
  const options: Array<{ key: Category | null; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    ...(includeAll ? [{ key: null, label: 'Todas', icon: 'apps-outline' as const }] : []),
    ...CATEGORIES,
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key ?? 'all'}
            style={({ pressed }) => [styles.categoryChip, active && styles.categoryChipActive, pressed && styles.buttonPressed]}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Ionicons name={option.icon} size={16} color={active ? colors.primary : colors.textSecondary} />
            <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ReactionButton({
  icon,
  label,
  count,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count: number;
  active: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.reactionButton, active && styles.reactionButtonActive, pressed && styles.buttonPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !onPress }}
    >
      <Ionicons name={active ? (icon.replace('-outline', '') as typeof icon) : icon} size={18} color={colors.primary} />
      <Text style={styles.reactionText}>
        {label} ({count})
      </Text>
    </Pressable>
  );
}

function questionMeta(question: Question): string {
  return [question.authorName, question.vehicleLabel, formatServerDate(question.createdAt)].filter(Boolean).join(' · ');
}

function answersLabel(count: number): string {
  if (count === 0) return 'Sin respuestas todavía';
  return count === 1 ? '1 respuesta de mecánico' : `${count} respuestas de mecánicos`;
}

function QuestionList({ api, setView }: { api: ApiCall; setView: (view: CommunityView) => void }) {
  const { setMessage } = useAppContext();
  const [scope, setScope] = useState<'public' | 'mine'>('public');
  const [category, setCategory] = useState<Category | null>(null);
  const [search, setSearch] = useState('');
  const [questions, setQuestions] = useState<Question[] | null>(null);

  useEffect(() => {
    // La búsqueda espera a que se deje de escribir para no pedir en cada letra.
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ scope });
      if (category) params.set('category', category);
      if (search.trim()) params.set('q', search.trim());
      api<{ questions: Question[] }>(`/api/community/questions?${params.toString()}`)
        .then((data) => setQuestions(data.questions))
        .catch((error) => setMessage(formatError(error)));
    }, search ? 400 : 0);
    return () => clearTimeout(timeout);
  }, [scope, category, search]);

  async function toggleFollow(question: Question) {
    try {
      const result = await api<{ active: boolean; count: number }>(`/api/community/questions/${question.id}/follow`, {
        method: 'POST',
      });
      setMessage(result.active ? 'Te avisaremos cuando la respondan' : 'Dejaste de seguir la pregunta');
      setQuestions((current) =>
        (current ?? []).map((item) =>
          item.id === question.id ? { ...item, followedByMe: result.active, followerCount: result.count } : item,
        ),
      );
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Segmented
          value={scope}
          onBackground
          options={[
            { key: 'public', label: 'Recientes', icon: 'time-outline' },
            { key: 'mine', label: 'Mis preguntas', icon: 'person-outline' },
          ]}
          onChange={(value) => setScope(value as 'public' | 'mine')}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
        <Card title="Pregúntale a un mecánico" subtitle="Mecánicos verificados responden gratis las dudas de tu auto.">
          <View style={styles.stack}>
            <Input value={search} onChangeText={setSearch} placeholder="Buscar preguntas" returnKeyType="search" />
            <CategoryChips value={category} onChange={setCategory} includeAll />
            <PrimaryButton title="Hacer una pregunta" onPress={() => setView({ mode: 'new' })} />
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(300)} needsOffscreenAlphaCompositing>
        <Card title={scope === 'mine' ? 'Tus preguntas' : 'Preguntas recientes'}>
          {questions === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : questions.length === 0 ? (
            <EmptyState
              icon="chatbubbles-outline"
              title={scope === 'mine' ? 'Todavía no preguntas nada' : 'No hay preguntas aquí'}
              text={search || category ? 'Prueba con otra búsqueda o categoría.' : 'Sé el primero en preguntar.'}
            />
          ) : (
            <View style={styles.list}>
              {questions.map((question) => (
                <Pressable
                  key={question.id}
                  style={({ pressed }) => [styles.item, pressed && styles.buttonPressed]}
                  onPress={() => setView({ mode: 'detail', questionId: question.id })}
                  accessibilityRole="button"
                >
                  <Text style={styles.smallText}>{questionMeta(question)}</Text>
                  <Text style={styles.itemTitle}>{question.title}</Text>
                  <Text numberOfLines={2} style={styles.itemText}>
                    {question.body}
                  </Text>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>{CATEGORY_LABELS[question.category]}</Text>
                  </View>
                  <InfoRow icon="chatbubble-ellipses-outline" text={answersLabel(question.answerCount)} />
                  <ReactionButton
                    icon="notifications-outline"
                    label={question.followedByMe ? 'Siguiendo' : 'Seguir'}
                    count={question.followerCount}
                    active={question.followedByMe}
                    onPress={question.isMine ? undefined : () => void toggleFollow(question)}
                  />
                </Pressable>
              ))}
            </View>
          )}
        </Card>
      </Animated.View>
    </>
  );
}

function NewQuestion({ api, setView }: { api: ApiCall; setView: (view: CommunityView) => void }) {
  const { vehicles, busy, setBusy, setMessage } = useAppContext();
  const [form, setForm] = useState({ title: '', body: '', category: null as Category | null, vehicleLabel: '' });

  async function publish() {
    if (form.title.trim().length < 5) {
      setMessage('Escribe en pocas palabras qué le pasa a tu auto');
      return;
    }
    if (!form.category) {
      setMessage('Elige una categoría');
      return;
    }
    if (form.body.trim().length < 10) {
      setMessage('Cuéntanos un poco más en la descripción');
      return;
    }
    setBusy(true);
    try {
      const created = await api<{ id: number }>('/api/community/questions', {
        method: 'POST',
        body: {
          title: form.title.trim(),
          body: form.body.trim(),
          category: form.category,
          ...(form.vehicleLabel.trim() ? { vehicleLabel: form.vehicleLabel.trim() } : {}),
        },
      });
      setMessage('Pregunta publicada. Te avisamos cuando un mecánico responda.');
      setView({ mode: 'detail', questionId: created.id });
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
      <Card title="Nueva pregunta" subtitle="Los mecánicos verificados de Mecanifique te responden.">
        <View style={styles.stack}>
          <Field label="¿Qué le pasa a tu auto?">
            <Input
              value={form.title}
              maxLength={120}
              placeholder="Ej. Mis frenos chillan al frenar"
              onChangeText={(value) => setForm({ ...form, title: value })}
            />
          </Field>
          <Field label="Categoría">
            <CategoryChips value={form.category} onChange={(category) => setForm({ ...form, category })} includeAll={false} />
          </Field>
          <Field label="Tu vehículo (opcional)">
            {vehicles.length > 0 ? (
              <View style={styles.row}>
                {vehicles.map((vehicle) => {
                  const label = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
                  return (
                    <ChoiceTile
                      key={vehicle.id}
                      icon="car-sport-outline"
                      title={vehicle.nickname || `${vehicle.make} ${vehicle.model}`}
                      description={String(vehicle.year)}
                      active={form.vehicleLabel === label}
                      style={styles.choiceHalf}
                      onPress={() => setForm({ ...form, vehicleLabel: form.vehicleLabel === label ? '' : label })}
                    />
                  );
                })}
              </View>
            ) : (
              <Input
                value={form.vehicleLabel}
                maxLength={80}
                placeholder="Ej. Nissan Versa 2018"
                onChangeText={(value) => setForm({ ...form, vehicleLabel: value })}
              />
            )}
          </Field>
          <Field label="Cuéntanos más">
            <Input
              value={form.body}
              multiline
              maxLength={2000}
              placeholder="¿Desde cuándo pasa? ¿Cuándo se nota? ¿Ya le hicieron algo?"
              onChangeText={(value) => setForm({ ...form, body: value })}
            />
            <CharCounter value={form.body} max={2000} />
          </Field>
          <SecondaryButton title="Cancelar" onPress={() => setView({ mode: 'list' })} />
          <PrimaryButton title="Enviar pregunta" busy={busy} onPress={() => void publish()} />
        </View>
      </Card>
    </Animated.View>
  );
}

function QuestionDetail({
  api,
  questionId,
  setView,
  onOpenMechanic,
}: {
  api: ApiCall;
  questionId: number;
  setView: (view: CommunityView) => void;
  onOpenMechanic: (mechanicId: number) => void;
}) {
  const { user, busy, setBusy, setMessage } = useAppContext();
  const [data, setData] = useState<{ question: Question; answers: Answer[] } | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');

  async function load() {
    try {
      setData(await api<{ question: Question; answers: Answer[] }>(`/api/community/questions/${questionId}`));
    } catch (error) {
      setMessage(formatError(error));
      setView({ mode: 'list' });
    }
  }

  useEffect(() => {
    void load();
  }, [questionId]);

  if (!data || !user) {
    return <ActivityIndicator color={colors.primary} />;
  }
  const { question, answers } = data;

  async function toggleFollow() {
    try {
      const result = await api<{ active: boolean; count: number }>(`/api/community/questions/${question.id}/follow`, {
        method: 'POST',
      });
      setMessage(result.active ? 'Te avisaremos cuando la respondan' : 'Dejaste de seguir la pregunta');
      setData((current) =>
        current ? { ...current, question: { ...current.question, followedByMe: result.active, followerCount: result.count } } : current,
      );
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function toggleHelpful(answer: Answer) {
    try {
      const result = await api<{ active: boolean; count: number }>(`/api/community/answers/${answer.id}/helpful`, {
        method: 'POST',
      });
      setData((current) =>
        current
          ? {
              ...current,
              answers: current.answers.map((item) =>
                item.id === answer.id ? { ...item, helpfulByMe: result.active, helpfulCount: result.count } : item,
              ),
            }
          : current,
      );
    } catch (error) {
      setMessage(formatError(error));
    }
  }

  async function publishAnswer() {
    if (answerDraft.trim().length < 10) {
      setMessage('Escribe una respuesta un poco más completa');
      return;
    }
    setBusy(true);
    try {
      await api(`/api/community/questions/${question.id}/answers`, { method: 'POST', body: { body: answerDraft.trim() } });
      setAnswerDraft('');
      setMessage('Respuesta publicada');
      await load();
    } catch (error) {
      setMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(kind: 'question' | 'answer', id: number) {
    Alert.alert(kind === 'question' ? '¿Borrar tu pregunta?' : '¿Borrar tu respuesta?', 'No se puede deshacer.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api(kind === 'question' ? `/api/community/questions/${id}` : `/api/community/answers/${id}`, {
              method: 'DELETE',
            });
            setMessage(kind === 'question' ? 'Pregunta borrada' : 'Respuesta borrada');
            if (kind === 'question') {
              setView({ mode: 'list' });
            } else {
              await load();
            }
          } catch (error) {
            setMessage(formatError(error));
          }
        },
      },
    ]);
  }

  return (
    <>
      <Animated.View entering={FadeInDown.delay(0).duration(300)} needsOffscreenAlphaCompositing>
        <Card title={question.title} subtitle={questionMeta(question)}>
          <View style={styles.stack}>
            <Text style={styles.itemText}>{question.body}</Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{CATEGORY_LABELS[question.category]}</Text>
            </View>
            <ReactionButton
              icon="notifications-outline"
              label={question.followedByMe ? 'Siguiendo' : 'Seguir'}
              count={question.followerCount}
              active={question.followedByMe}
              onPress={question.isMine ? undefined : () => void toggleFollow()}
            />
            {(question.isMine || user.role === 'admin') && (
              <SecondaryButton
                title={question.isMine ? 'Borrar mi pregunta' : 'Borrar pregunta'}
                compact
                onPress={() => confirmDelete('question', question.id)}
              />
            )}
          </View>
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(300)} needsOffscreenAlphaCompositing>
        <Card title={answers.length === 1 ? '1 respuesta' : `${answers.length} respuestas`}>
          {answers.length === 0 ? (
            <Text style={styles.smallText}>
              {question.isMine
                ? 'Todavía nadie responde. Te avisamos en cuanto un mecánico lo haga.'
                : 'Todavía nadie responde esta pregunta.'}
            </Text>
          ) : (
            <View style={styles.list}>
              {answers.map((answer) => (
                <View key={answer.id} style={styles.item}>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemIcon}>
                      <Ionicons name="construct-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.infoRow}>
                        <Text style={styles.itemTitle}>{answer.mechanicName}</Text>
                        {answer.mechanicVerified && (
                          <Ionicons name="checkmark-circle" size={16} color="#16a34a" accessibilityLabel="Verificado" />
                        )}
                      </View>
                      <Text style={styles.smallText}>
                        ★ {answer.rating.toFixed(1)} · {answer.jobsCompleted} trabajos · {formatServerDate(answer.createdAt)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.itemText}>{answer.body}</Text>
                  <ReactionButton
                    icon="bulb-outline"
                    label="Útil"
                    count={answer.helpfulCount}
                    active={answer.helpfulByMe}
                    onPress={answer.isMine ? undefined : () => void toggleHelpful(answer)}
                  />
                  {user.role === 'customer' && (
                    <SecondaryButton title="Pedir a este mecánico" compact onPress={() => onOpenMechanic(answer.mechanicId)} />
                  )}
                  {(answer.isMine || user.role === 'admin') && (
                    <SecondaryButton title="Borrar respuesta" compact onPress={() => confirmDelete('answer', answer.id)} />
                  )}
                </View>
              ))}
            </View>
          )}
        </Card>
      </Animated.View>

      {user.role === 'mechanic' && !question.isMine && (
        <Animated.View entering={FadeInDown.delay(120).duration(300)} needsOffscreenAlphaCompositing>
          <Card title="Tu respuesta" subtitle="Una buena respuesta es la mejor forma de que un cliente te contrate.">
            <View style={styles.stack}>
              <Input
                value={answerDraft}
                multiline
                maxLength={2000}
                placeholder="Explica qué puede ser y qué conviene revisar."
                onChangeText={setAnswerDraft}
              />
              <CharCounter value={answerDraft} max={2000} />
              <PrimaryButton title="Publicar respuesta" busy={busy} onPress={() => void publishAnswer()} />
            </View>
          </Card>
        </Animated.View>
      )}
    </>
  );
}

export function CommunityScreen({
  api,
  view,
  setView,
  onOpenMechanic,
}: {
  api: ApiCall;
  view: CommunityView;
  setView: (view: CommunityView) => void;
  onOpenMechanic: (mechanicId: number) => void;
}) {
  if (view.mode === 'new') {
    return <NewQuestion api={api} setView={setView} />;
  }
  if (view.mode === 'detail') {
    return <QuestionDetail key={view.questionId} api={api} questionId={view.questionId} setView={setView} onOpenMechanic={onOpenMechanic} />;
  }
  return <QuestionList api={api} setView={setView} />;
}
