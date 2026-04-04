// Client-side age decryption using the age-encryption WASM module.
// Load from CDN for zero-build-step usage.

const AGE_CDN = 'https://cdn.jsdelivr.net/npm/age-encryption@0.4.4/+esm';

let ageModule = null;

async function loadAge() {
  if (ageModule) return ageModule;
  try {
    ageModule = await import(AGE_CDN);
    return ageModule;
  } catch {
    throw new Error(
      'Failed to load age-encryption from CDN. Check network connectivity.'
    );
  }
}

export const Decrypter = {
  async decrypt(encryptedBytes, secretKey) {
    if (!secretKey || !secretKey.startsWith('AGE-SECRET-KEY-')) {
      throw new Error('Invalid key format. Must start with AGE-SECRET-KEY-');
    }
    const age = await loadAge();
    const d = new age.Decrypter();
    d.addIdentity(secretKey);
    const decrypted = await d.decrypt(encryptedBytes);
    return new TextDecoder().decode(decrypted);
  }
};
