/**
 * Browser-side encryption helpers for data that must be persisted in
 * `localStorage` (for example Cognito session tokens).
 *
 * Sensitive values are encrypted with AES-GCM using a non-extractable
 * `CryptoKey`. The key is persisted in IndexedDB so it survives reloads but
 * cannot be serialized out of the browser. When IndexedDB is unavailable the
 * key is kept in memory only, so values written in one page session can still
 * be read back during that session without ever being stored in clear text.
 */

const KEY_DB_NAME = 'admin_auth_secure_store';
const KEY_DB_STORE = 'keys';
const KEY_RECORD_ID = 'token_encryption_key';
const IV_BYTE_LENGTH = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let cachedKeyPromise: Promise<CryptoKey> | null = null;

function getCryptoSubtle(): SubtleCrypto | null {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }
  return crypto.subtle;
}

function getIndexedDbFactory(): IDBFactory | null {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  return indexedDB;
}

function openKeyDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(KEY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_DB_STORE)) {
        db.createObjectStore(KEY_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPersistedKey(): Promise<CryptoKey | null> {
  const factory = getIndexedDbFactory();
  if (!factory) {
    return null;
  }
  try {
    const db = await openKeyDatabase(factory);
    try {
      return await new Promise<CryptoKey | null>((resolve, reject) => {
        const transaction = db.transaction(KEY_DB_STORE, 'readonly');
        const request = transaction.objectStore(KEY_DB_STORE).get(KEY_RECORD_ID);
        request.onsuccess = () => {
          const value = request.result;
          resolve(value instanceof CryptoKey ? value : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function persistKey(key: CryptoKey): Promise<void> {
  const factory = getIndexedDbFactory();
  if (!factory) {
    return;
  }
  try {
    const db = await openKeyDatabase(factory);
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(KEY_DB_STORE, 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore(KEY_DB_STORE).put(key, KEY_RECORD_ID);
      });
    } finally {
      db.close();
    }
  } catch {
    // A persistence failure is non-fatal; the in-memory key still works for
    // the current page session.
  }
}

async function resolveEncryptionKey(subtle: SubtleCrypto): Promise<CryptoKey> {
  const persisted = await readPersistedKey();
  if (persisted) {
    return persisted;
  }
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await persistKey(key);
  return key;
}

function getEncryptionKey(subtle: SubtleCrypto): Promise<CryptoKey> {
  if (!cachedKeyPromise) {
    cachedKeyPromise = resolveEncryptionKey(subtle).catch((error) => {
      cachedKeyPromise = null;
      throw error;
    });
  }
  return cachedKeyPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Encrypts a UTF-8 string, returning a base64 payload that bundles the IV. */
export async function encryptToBase64(plaintext: string): Promise<string> {
  const subtle = getCryptoSubtle();
  if (!subtle) {
    throw new Error('Web Crypto is not available for secure storage.');
  }
  const key = await getEncryptionKey(subtle);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext),
  );
  const ciphertextBytes = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + ciphertextBytes.length);
  combined.set(iv, 0);
  combined.set(ciphertextBytes, iv.length);
  return bytesToBase64(combined);
}

/** Decrypts a payload produced by {@link encryptToBase64}, or null on failure. */
export async function decryptFromBase64(payload: string): Promise<string | null> {
  const subtle = getCryptoSubtle();
  if (!subtle) {
    return null;
  }
  try {
    const key = await getEncryptionKey(subtle);
    const combined = base64ToBytes(payload);
    const iv = combined.subarray(0, IV_BYTE_LENGTH);
    const ciphertext = combined.subarray(IV_BYTE_LENGTH);
    const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return textDecoder.decode(plaintext);
  } catch {
    return null;
  }
}
