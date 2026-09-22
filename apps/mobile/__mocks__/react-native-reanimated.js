/**
 * Reanimated 4 runs on react-native-worklets, which reaches for native
 * bindings the moment it is imported — there is no native side under Jest, and
 * neither package ships a mock any more.
 *
 * This stands in for the parts the app actually uses. It animates nothing: the
 * component tests assert accessibility labels and structure, and motion is
 * verified on a device. Anything here returning a static value is saying "this
 * is not what is tested", not "this is how it behaves".
 */
const React = require('react');
const { View } = require('react-native');

const createAnimatedComponent = (Component) =>
  React.forwardRef(({ animatedProps, ...props }, ref) => React.createElement(Component, { ...props, ...animatedProps, ref }));

const Animated = {
  View,
  Text: require('react-native').Text,
  ScrollView: require('react-native').ScrollView,
  createAnimatedComponent,
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  useSharedValue: (initial) => ({ value: initial }),
  useAnimatedStyle: (factory) => factory(),
  useAnimatedProps: (factory) => factory(),
  useDerivedValue: (factory) => ({ value: factory() }),
  withSpring: (toValue) => toValue,
  withTiming: (toValue) => toValue,
  withDelay: (_delay, value) => value,
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
  cancelAnimation: () => undefined,
  Easing: { linear: (t) => t, inOut: (fn) => fn, ease: (t) => t },
};
