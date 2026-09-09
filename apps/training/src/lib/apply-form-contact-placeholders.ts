import type { FormContent, FormQuestion } from '@/content/form-types';
import {
  applyContactPlaceholderTemplate,
  mergeFormContactPlaceholders,
} from '@/lib/contact-placeholders';

export function applyFormContactPlaceholders(
  form: FormContent,
  placeholders: Record<string, string> | null | undefined,
): FormContent {
  const values = mergeFormContactPlaceholders(placeholders);
  return {
    ...form,
    title: applyContactPlaceholderTemplate(form.title, values),
    completion: form.completion
      ? {
          ...form.completion,
          description: form.completion.description
            ? applyContactPlaceholderTemplate(form.completion.description, values)
            : form.completion.description,
        }
      : form.completion,
    questions: form.questions.map((question) => personalizeQuestion(question, values)),
  };
}

function personalizeQuestion(question: FormQuestion, values: Record<string, string>): FormQuestion {
  const questionText = applyContactPlaceholderTemplate(question.question, values);
  const hint = question.hint ? applyContactPlaceholderTemplate(question.hint, values) : question.hint;
  const screen = question.screen
    ? applyContactPlaceholderTemplate(question.screen, values)
    : question.screen;

  if (question.type === 'select' || question.type === 'multiselect') {
    return {
      ...question,
      question: questionText,
      hint,
      screen,
      options: question.options.map((option) => applyContactPlaceholderTemplate(option, values)),
    };
  }
  if (question.type === 'segmented') {
    return {
      ...question,
      question: questionText,
      hint,
      screen,
      options: question.options.map((option) => ({
        ...option,
        label: applyContactPlaceholderTemplate(option.label, values),
      })),
    };
  }
  if (question.type === 'consent') {
    return {
      ...question,
      question: questionText,
      hint,
      screen,
      consentText: applyContactPlaceholderTemplate(question.consentText, values),
      followUp: question.followUp
        ? {
            ...question.followUp,
            placeholder: applyContactPlaceholderTemplate(question.followUp.placeholder, values),
          }
        : question.followUp,
    };
  }
  if (question.type === 'text' || question.type === 'email') {
    return {
      ...question,
      question: questionText,
      hint,
      screen,
      placeholder: question.placeholder
        ? applyContactPlaceholderTemplate(question.placeholder, values)
        : question.placeholder,
    };
  }
  return {
    ...question,
    question: questionText,
    hint,
    screen,
  };
}
