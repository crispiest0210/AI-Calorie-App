import '@testing-library/react-native/matchers';

/*
 * Reanimated 4 no longer wants a hand-written mock: requiring its `mock`
 * entry pulls in the real module's native bindings and throws. jest-expo's
 * preset handles the module; gesture-handler still needs its setup file.
 */
require('react-native-gesture-handler/jestSetup');
