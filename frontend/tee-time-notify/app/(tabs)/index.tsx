import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  SafeAreaView,
  Platform,
} from "react-native";
import {
  Text,
  TextInput,
  Card,
  ActivityIndicator,
  useTheme,
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";

type Course = {
  id: number;
  name: string;
  city: string;
  state: string;
  provider: string;
};

export default function CourseSearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setCourses([]);
      return;
    }

    const fetchCourses = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("courses")
        .select("id, name, city, state, provider")
        .ilike("name", `%${query.trim()}%`)
        .limit(25);

      if (error) console.error(error);
      else setCourses(data || []);
      setLoading(false);
    };

    const debounce = setTimeout(fetchCourses, 300);
    return () => clearTimeout(debounce);
  }, [query]);

  const handleSelectCourse = (course: Course) => {
    router.push({
      pathname: "/create-details",
      params: { id: course.id, name: course.name },
    });
  };

  const isDark = theme.dark;

  return (
    <SafeAreaView
      style={[
        styles.safe,
        { backgroundColor: theme.colors.background },
      ]}
    >
      <View style={styles.container}>
        <Text
          variant="headlineMedium"
          style={[
            styles.title,
            { color: theme.colors.onBackground },
          ]}
        >
          Create New Alert
        </Text>

        <TextInput
          label="Search Course"
          value={query}
          onChangeText={setQuery}
          mode="outlined"
          right={<TextInput.Icon icon="magnify" />}
          style={[
            styles.search,
            {
              backgroundColor: theme.colors.surface,
            },
          ]}
          textColor={theme.colors.onSurface}
          placeholderTextColor={isDark ? "#ccc" : "#666"}
        />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator animating color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={courses}
            keyExtractor={(item) => item.id.toString()}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingVertical: 10,
            }}
            renderItem={({ item }) => (
              <Card
                mode="elevated"
                style={[
                  styles.card,
                  {
                    backgroundColor: isDark
                      ? theme.colors.surface
                      : "#fff",
                  },
                ]}
                onPress={() => handleSelectCourse(item)}
              >
                <Card.Title
                  title={item.name}
                  subtitle={`${item.city}, ${item.state}`}
                  titleStyle={[
                    styles.cardTitle,
                    { color: theme.colors.onSurface },
                  ]}
                  subtitleStyle={[
                    styles.cardSubtitle,
                    { color: isDark ? "#bbb" : "#555" },
                  ]}
                />
              </Card>
            )}
            ListEmptyComponent={
              query ? (
                <Text style={[styles.helper, { color: theme.colors.onSurface }]}>
                  No courses found.
                </Text>
              ) : (
                <Text style={[styles.helper, { color: theme.colors.onSurface }]}>
                  Start typing to search courses.
                </Text>
              )
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  title: {
    marginBottom: 10,
    fontWeight: "600",
  },
  search: {
    marginBottom: 12,
  },
  card: {
    marginBottom: 8,
    borderRadius: 10,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 4,
        shadowOffset: { height: 2, width: 0 },
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardSubtitle: {
    fontSize: 13,
  },
  helper: {
    textAlign: "center",
    marginTop: 24,
    fontSize: 14,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});