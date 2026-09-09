'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  emptyFormAnswerState,
  getFormValidationError,
  type FormAnswerState,
} from '@/components/forms/form-answer-state';
import { FormQuestionField } from '@/components/forms/form-question-field';
import type { FormContent, FormsCommonContent } from '@/content/form-types';
import { formatProgressLabel } from '@/lib/format-template';
import { getOrCreateFormSessionId } from '@/lib/form-session';
import {
  loadFormProgress,
  mergeStoredAnswers,
  saveFormProgress,
} from '@/lib/form-session-storage';
import { FormApiError, persistFormAnswer } from '@/lib/forms-api';

export interface FormWizardProps {
  form: FormContent;
  common: FormsCommonContent;
  contactId?: string | null;
}

export function FormWizard({ form, common, contactId = null }: FormWizardProps) {
  const sessionId = useMemo(
    () => getOrCreateFormSessionId(form.slug, contactId),
    [form.slug, contactId],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [answersByQuestionId, setAnswersByQuestionId] = useState<
    Record<string, FormAnswerState>
  >({});
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    const stored = loadFormProgress(form.slug, sessionId);
    if (stored) {
      // Client-only resume from sessionStorage after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate wizard state once per session
      setAnswersByQuestionId(mergeStoredAnswers(stored.answersByQuestionId));
      setStepIndex(stored.stepIndex);
    }
    setHasHydrated(true);
  }, [form.slug, sessionId]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    saveFormProgress(form.slug, sessionId, {
      stepIndex,
      answersByQuestionId,
    });
  }, [answersByQuestionId, form.slug, hasHydrated, sessionId, stepIndex]);

  const questions = form.questions;
  const totalSteps = questions.length;
  const resolvedStepIndex = totalSteps === 0 ? 0 : Math.min(stepIndex, totalSteps - 1);
  const currentQuestion = questions[resolvedStepIndex];
  const currentAnswer = currentQuestion
    ? (answersByQuestionId[currentQuestion.id] ?? emptyFormAnswerState())
    : emptyFormAnswerState();

  const progressLabel = formatProgressLabel(
    common.a11y.progressTemplate,
    totalSteps === 0 ? 0 : resolvedStepIndex + 1,
    totalSteps,
  );

  if (isComplete || totalSteps === 0) {
    return (
      <section className='mx-auto flex w-full max-w-xl flex-col gap-3 text-center'>
        <h2 className='es-type-title text-2xl'>{common.completion.title}</h2>
        <p className='es-text-body text-base'>
          {form.completion?.description ?? common.completion.description}
        </p>
      </section>
    );
  }

  if (!currentQuestion) {
    return null;
  }

  const isFirstStep = resolvedStepIndex === 0;
  const isLastStep = resolvedStepIndex === totalSteps - 1;
  const primaryLabel = isLastStep ? common.navigation.finish : common.navigation.next;

  return (
    <section className='mx-auto flex w-full max-w-xl flex-col gap-6'>
      <p className='es-text-muted text-sm'>{progressLabel}</p>
      <FormQuestionField
        question={currentQuestion}
        common={common}
        answer={currentAnswer}
        onAnswerChange={(patch) => updateAnswerState(currentQuestion.id, patch)}
      />
      {errorMessage ? (
        <p className='es-text-danger text-sm' role='alert'>
          {errorMessage}
        </p>
      ) : null}
      <div className='flex flex-wrap items-center justify-start gap-2'>
        {!isFirstStep ? (
          <button
            type='button'
            className='es-btn es-btn--primary es-btn--outline es-focus-ring'
            disabled={isSaving}
            onClick={() => {
              setErrorMessage(null);
              setStepIndex((index) => Math.max(0, index - 1));
            }}
          >
            {common.navigation.back}
          </button>
        ) : null}
        <button
          type='button'
          className='es-btn es-btn--primary es-focus-ring'
          disabled={isSaving}
          onClick={() => void handlePrimaryAction()}
        >
          {primaryLabel}
        </button>
      </div>
    </section>
  );

  function updateAnswerState(questionId: string, patch: Partial<FormAnswerState>): void {
    setAnswersByQuestionId((previous) => ({
      ...previous,
      [questionId]: {
        ...emptyFormAnswerState(),
        ...previous[questionId],
        ...patch,
      },
    }));
  }

  async function handlePrimaryAction(): Promise<void> {
    setErrorMessage(null);

    const validationError = getFormValidationError(currentQuestion, currentAnswer, common);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSaving(true);
    try {
      await persistFormAnswer({
        formSlug: form.slug,
        sessionId,
        question: currentQuestion,
        answer: currentAnswer,
        contactId,
      });
    } catch (error) {
      setErrorMessage(resolvePersistErrorMessage(error, common));
      setIsSaving(false);
      return;
    }
    setIsSaving(false);

    if (isLastStep) {
      setIsComplete(true);
      return;
    }
    setStepIndex((index) => Math.min(index + 1, totalSteps - 1));
  }
}

function resolvePersistErrorMessage(error: unknown, common: FormsCommonContent): string {
  if (error instanceof FormApiError && error.statusCode === 0) {
    return common.errors.missingApiConfig;
  }
  return common.errors.persistFailed;
}
