'use client';

import { useState, type FormEvent } from 'react';

import { DEFAULT_ADMIN_SECTION_PATH } from '@/lib/admin-nav';

import { useAuth } from './auth-provider';
import { EmailIcon, GoogleIcon } from './icons/action-icons';
import { StatusBanner } from './status-banner';
import { AdminInlineError } from './ui/admin-inline-error';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

function isValidEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function LoginScreen() {
  const {
    login,
    configErrors,
    error,
    passwordlessStatus,
    passwordlessError,
    passwordlessEmail,
    sendPasswordlessCode,
    verifyPasswordlessCode,
    resetPasswordless,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [codeSubmitted, setCodeSubmitted] = useState(false);

  const hasConfigErrors = configErrors.length > 0;
  const hasError = error.length > 0;
  const hasPasswordlessError = passwordlessError.length > 0;
  const isSending = passwordlessStatus === 'sending';
  const isVerifying = passwordlessStatus === 'verifying';
  const isLoading = isSending || isVerifying;
  const showCodeInput =
    passwordlessStatus === 'challenge' || passwordlessStatus === 'verifying';

  const trimmedEmail = email.trim();
  const emailError = !trimmedEmail
    ? 'Enter your work email.'
    : isValidEmail(trimmedEmail)
      ? ''
      : 'Enter a valid email address.';
  const showEmailError = Boolean(emailError && (emailTouched || emailSubmitted));

  const trimmedCode = code.trim();
  const codeError = !trimmedCode
    ? 'Enter the verification code.'
    : /^[0-9]{6}$/.test(trimmedCode)
      ? ''
      : 'Enter the 6-digit code.';
  const showCodeError = Boolean(codeError && (codeTouched || codeSubmitted));

  const errorInputClassName =
    'border-red-500 focus:border-red-500 focus:ring-red-500';

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailSubmitted(true);
    setEmailTouched(true);
    await sendPasswordlessCode(email);
  };

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCodeSubmitted(true);
    setCodeTouched(true);
    await verifyPasswordlessCode(code);
  };

  const handleBackToEmail = () => {
    resetPasswordless();
    setCode('');
    setCodeTouched(false);
    setCodeSubmitted(false);
  };

  const handleGoogleLogin = () => {
    void login({ provider: 'Google', returnTo: DEFAULT_ADMIN_SECTION_PATH });
  };

  return (
    <main className='min-h-screen bg-slate-50'>
      <div className='mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]'>
        <section className='relative hidden flex-col justify-between overflow-hidden bg-slate-900 text-white lg:flex'>
          <div className='absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700' />
          <div className='relative z-10 p-10'>
            <p className='text-xs font-semibold uppercase tracking-[0.3em] text-slate-300'>
              Evolve Sprouts
            </p>
            <h2 className='mt-4 text-3xl font-semibold leading-tight'>
              Admin access
            </h2>
            <p className='mt-4 text-sm text-slate-200'>
              Sign in securely to manage operations, onboarding, and internal admin
              workflows.
            </p>
            <ul className='mt-6 space-y-3 text-sm text-slate-200'>
              <li className='flex items-start gap-3'>
                <span className='mt-2 h-1.5 w-1.5 rounded-full bg-emerald-300' />
                Authenticate with Google SSO or email verification code.
              </li>
              <li className='flex items-start gap-3'>
                <span className='mt-2 h-1.5 w-1.5 rounded-full bg-emerald-300' />
                Access is governed by Cognito groups and backend authorization.
              </li>
              <li className='flex items-start gap-3'>
                <span className='mt-2 h-1.5 w-1.5 rounded-full bg-emerald-300' />
                Keep your account secure with one-time challenges and short-lived
                tokens.
              </li>
            </ul>
          </div>
          <div className='relative z-10 p-10 text-xs text-slate-300'>
            Use your organization email to request access if needed.
          </div>
        </section>

        <section className='flex items-center justify-center px-6 py-10 sm:px-10'>
          <div className='w-full max-w-md'>
            <div className='mb-6 space-y-2'>
              <p className='text-xs font-semibold uppercase tracking-[0.3em] text-slate-500'>
                Evolve Sprouts Admin
              </p>
              <h1 className='text-2xl font-semibold text-slate-900'>
                Welcome back
              </h1>
              <p className='text-sm text-slate-600'>
                Continue with Google or sign in with your email code.
              </p>
            </div>

            <Card className='w-full'>
              {(hasError || hasConfigErrors || hasPasswordlessError) && (
                <div className='mb-4 space-y-2'>
                  {hasError && (
                    <StatusBanner variant='error' title='Login'>
                      {error}
                    </StatusBanner>
                  )}
                  {hasPasswordlessError && (
                    <StatusBanner variant='error' title='Email sign in'>
                      {passwordlessError}
                    </StatusBanner>
                  )}
                  {configErrors.map((configError) => (
                    <StatusBanner key={configError} variant='error' title='Config'>
                      {configError}
                    </StatusBanner>
                  ))}
                </div>
              )}

              <Button
                type='button'
                variant='outline'
                onClick={handleGoogleLogin}
                disabled={hasConfigErrors || isLoading}
                className='h-11 w-full justify-start gap-3 text-sm font-semibold'
              >
                <span
                  aria-hidden='true'
                  className='flex h-5 w-5 items-center justify-center'
                >
                  <GoogleIcon className='h-5 w-5' />
                </span>
                Continue with Google
              </Button>

              <div className='relative my-6'>
                <div className='absolute inset-0 flex items-center'>
                  <div className='w-full border-t border-slate-200' />
                </div>
                <div className='relative flex justify-center text-xs uppercase tracking-[0.3em] text-slate-500'>
                  <span className='bg-white px-3'>Or</span>
                </div>
              </div>

              {!showCodeInput ? (
                <form onSubmit={handleEmailSubmit} className='space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='email'>Work email *</Label>
                    <Input
                      id='email'
                      type='email'
                      placeholder='you@example.com'
                      value={email}
                      onChange={(event) => {
                        setEmailTouched(true);
                        setEmail(event.target.value);
                      }}
                      disabled={isLoading || hasConfigErrors}
                      required
                      autoComplete='email'
                      autoFocus
                      className={showEmailError ? errorInputClassName : ''}
                      aria-invalid={showEmailError || undefined}
                    />
                    {showEmailError ? <AdminInlineError size='xs'>{emailError}</AdminInlineError> : null}
                  </div>
                  <Button
                    type='submit'
                    disabled={isLoading || hasConfigErrors || !email.trim()}
                    loading={isSending}
                    loadingLabel='Sending code…'
                    className='h-11 w-full text-base sm:text-sm'
                  >
                    <span
                      aria-hidden='true'
                      className='mr-2 inline-flex h-4 w-4 items-center justify-center'
                    >
                      <EmailIcon className='h-4 w-4' />
                    </span>
                    Email me a verification code
                  </Button>
                  <p className='text-center text-xs text-slate-600'>
                    We will send a one-time 6-digit code.
                  </p>
                </form>
              ) : (
                <form onSubmit={handleCodeSubmit} className='space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='code'>Verification code *</Label>
                    <Input
                      id='code'
                      type='text'
                      inputMode='numeric'
                      pattern='[0-9]*'
                      placeholder='123456'
                      value={code}
                      onChange={(event) => {
                        setCodeTouched(true);
                        setCode(event.target.value);
                      }}
                      disabled={isLoading}
                      required
                      autoComplete='one-time-code'
                      autoFocus
                      className={showCodeError ? errorInputClassName : ''}
                      aria-invalid={showCodeError || undefined}
                    />
                    {showCodeError ? <AdminInlineError size='xs'>{codeError}</AdminInlineError> : null}
                    <p className='text-xs text-slate-600'>
                      Enter the 6-digit code sent to{' '}
                      <span className='font-medium'>{passwordlessEmail}</span>
                    </p>
                  </div>
                  <Button
                    type='submit'
                    disabled={isLoading || !code.trim()}
                    loading={isVerifying}
                    loadingLabel='Verifying…'
                    className='h-11 w-full text-base sm:text-sm'
                  >
                    Verify code
                  </Button>
                  <button
                    type='button'
                    onClick={handleBackToEmail}
                    disabled={isLoading}
                    className='w-full text-center text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50'
                  >
                    Use a different email
                  </button>
                </form>
              )}

              <p className='mt-6 text-center text-xs text-slate-600'>
                Admin access is restricted to approved team members.
              </p>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
