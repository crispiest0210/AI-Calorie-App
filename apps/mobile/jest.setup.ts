import '@testing-library/react-native/matchers';

// Reanimated ships a Jest mock; gesture-handler needs its setup file.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
require('react-native-gesture-handler/jestSetup');
