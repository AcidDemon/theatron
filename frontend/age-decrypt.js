// Client-side age decryption wrapper.
//
// Requires the age-encryption npm package. To set up:
//   cd frontend && npm init -y && npm install age-encryption
//   Then bundle with esbuild/vite/webpack.
//
// For development without a bundler, this provides a placeholder
// that explains the setup.

export const Decrypter = {
  async decrypt(encryptedBytes, secretKey) {
    // Try dynamic import of the age-encryption package
    try {
      const age = await import('age-encryption');
      const decrypter = new age.Decrypter();
      decrypter.addIdentity(secretKey);
      const decrypted = await decrypter.decrypt(encryptedBytes);
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      if (e.message && e.message.includes('Failed to resolve module')) {
        throw new Error(
          'age-encryption module not found. ' +
          'Run: cd frontend && npm install age-encryption && npx esbuild --bundle age-decrypt.js --outfile=dist/age-decrypt.js'
        );
      }
      throw e;
    }
  }
};
