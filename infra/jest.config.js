module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/lib'],
  testMatch: ['**/*.test.ts'],
  // Resolve .ts before .js so stale compiled output (tsc emits handler JS next to
  // sources for the Lambda@Edge asset bundle) can never shadow the source under test.
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
