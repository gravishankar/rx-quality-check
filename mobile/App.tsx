/** React Native root (product name: config/brand.json) (Android and iOS share everything below). */
import React from 'react';
import { App as Root } from './app/AppRoot.tsx';
import { nativePlatform } from './app/platform/native.ts';

export default function App() {
  return <Root platform={nativePlatform} />;
}
