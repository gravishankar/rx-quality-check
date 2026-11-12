/**
 * React Native entry point (Android and iOS). Polyfills a CSPRNG for crypto.getRandomValues
 * (database key generation) before any app code runs.
 */
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
