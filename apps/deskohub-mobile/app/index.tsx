import { StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Deskohub</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#00024f",
    flex: 1,
    justifyContent: "center",
  },
  title: { color: "#ffffff", fontSize: 32 },
});
