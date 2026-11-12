/**
 * UI flow tests (Task 4A.2): render the real screens with react-test-renderer and drive complete
 * workflows. Native modules are replaced by a fake PlatformServices; network responses are the
 * recorded real openFDA/RxNav/DailyMed responses (tests/fixtures/task3/cassette.json).
 * Test-only dependencies: jest, react-test-renderer, @react-native/jest-preset (no network use at
 * runtime; not bundled into the APK).
 */
module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transformIgnorePatterns: ['node_modules/(?!(@react-native|react-native|react-native-safe-area-context)/)'],
};
