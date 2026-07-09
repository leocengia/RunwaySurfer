// ESLint (flat config) per l'estensione: TypeScript + regole React hooks.
// Il backend ha la sua config in server/eslint.config.js.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['.wxt/**', '.output/**', 'node_modules/**', 'server/**', 'dist/**'],
  },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // Consenti argomenti volutamente inutilizzati con prefisso _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
