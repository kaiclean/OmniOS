import next from 'eslint-config-next';

const config = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'dist/**', 'coverage/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // The persistence adapter must stay swappable: everything goes through lib/data/store.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/data/adapters/*'],
              message:
                'Import the workspace store via lib/data/store.ts so the persistence adapter stays swappable.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
