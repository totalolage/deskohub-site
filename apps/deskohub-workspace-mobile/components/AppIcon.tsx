import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { type ColorValue, StyleSheet, View } from "react-native";

export function AppIcon({
  color,
  name,
  size = 24,
}: {
  color: ColorValue;
  name: ComponentProps<typeof SymbolView>["name"];
  size?: number;
}) {
  return (
    <View aria-hidden style={[styles.frame, { height: size, width: size }]}>
      <SymbolView name={name} size={size} tintColor={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
  },
});
