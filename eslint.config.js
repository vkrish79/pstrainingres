import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Lint config, added because the same bug shipped to production three times in
// one day: an identifier that was renamed or deleted in one place and left
// behind in another.
//
//   ExerciseResponses   `stat is not defined`            → blank screen
//   SessionDashboardPage `formatDateRange is not defined` → blank screen
//   ParticipantAssessmentPage `deadlineMs`/`nowMs`        → caught before push
//
// Every one of them passed `vite build`, because Rollup treats an unresolved
// identifier as a global and says nothing. The .verify harnesses cannot catch
// them either — they render static markup and pure functions, and a
// ReferenceError inside a component or a useMemo is invisible to that.
//
// So the single rule that earns this config is `no-undef`. Everything else
// here is either supporting it (knowing what a browser global is) or cheap
// enough to come along.
export default [
  {
    ignores: [
      'dist',
      'node_modules',
      // Local-only Playwright harness: Node ESM with its own globals, and
      // gitignored. Not worth configuring a second environment for.
      '.verify',
      // Deno, not browser — a different global set entirely.
      'supabase/functions',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Vite's import.meta.env is typed, not global, so nothing needed there.
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,

      // THE RULE THIS EXISTS FOR. Never a warning.
      'no-undef': 'error',

      // Two hook rules, chosen rather than the plugin's whole recommended set.
      // eslint-plugin-react-hooks v7 ships the React Compiler ruleset — purity,
      // immutability, set-state-in-effect and friends — which flags 51
      // pre-existing things here, 43 of them set-state-in-effect. Those are
      // worth working through one day, but turning them on today would mean a
      // lint run nobody reads, which is the same as no lint run at all.
      // Calling a hook conditionally is a real bug; a missing dependency is
      // usually worth a look.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Unused variables are usually a leftover from exactly the kind of edit
      // that causes the above, so they are worth seeing — but as warnings, so
      // they cannot block a build over a deliberately unused argument.
      'no-unused-vars': ['warn', {
        // Components and constants are often referenced only from JSX, which
        // this parser does not track without the react plugin (incompatible
        // with ESLint 10 at time of writing).
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

      // An empty catch is how "clipboard blocked, never mind" is written in
      // this codebase, and that is a legitimate thing to want.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
