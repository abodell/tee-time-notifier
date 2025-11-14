import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  Alert as RNAlert,
} from "react-native";
import {
  Text,
  useTheme,
  Card,
  IconButton,
  ActivityIndicator,
} from "react-native-paper";
import { supabase } from "@/lib/supabase";
import { getUserAlerts, deleteAlert } from "@/lib/api";
import { Alert as AlertType } from "@/types/alert";
import Toast from "react-native-toast-message";
import dayjs from "dayjs";

/**
 * My Alerts Screen
 * Displays all user alerts with modernized UI and full course info.
 */
export default function MyAlertsScreen() {
  const theme = useTheme();
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return;

      const result = await getUserAlerts(user.id);
      setAlerts(result);
    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Failed to load alerts",
        text2: err.message,
        position: "top",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const confirmDelete = (alertId: number) => {
    RNAlert.alert("Delete Alert", "Are you sure you want to remove this alert?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => handleDelete(alertId),
      },
    ]);
  };

  const handleDelete = async (alertId: number) => {
    try {
      await deleteAlert(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      Toast.show({
        type: "success",
        text1: "Alert deleted",
        position: "top",
      });
    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Failed to delete alert",
        text2: err.message,
        position: "top",
      });
    }
  };

  const renderItem = ({ item }: { item: AlertType }) => {
    const course = item.courses || {};
    return (
      <Card
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderRadius: 12 },
        ]}
        mode="elevated"
      >
        <Card.Title
          title={course.name || `Course #${item.course_id}`}
          subtitle={
            course.city && course.state
              ? `${course.city}, ${course.state}`
              : course.city || course.state || "Location unavailable"
          }
          titleVariant="titleMedium"
          subtitleVariant="bodySmall"
          right={(props) => (
            <IconButton
              {...props}
              icon="delete"
              iconColor={theme.colors.error}
              onPress={() => confirmDelete(item.id!)}
            />
          )}
        />
        <Card.Content style={styles.cardContent}>
          <Text
            style={{
              color: theme.colors.primary,
              fontWeight: "600",
              marginBottom: 4,
            }}
          >
            {item.holes} Holes
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>
            {dayjs(item.date_from).format("MMM D, YYYY")} —{" "}
            {dayjs(item.date_to || item.date_from).format("MMM D, YYYY")}
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 2 }}>
            {dayjs(item.start_time).format("h:mm A")} →{" "}
            {dayjs(item.end_time).format("h:mm A")}
          </Text>
          {item.active === false && (
            <Text style={{ color: theme.colors.error, marginTop: 6 }}>
              Inactive
            </Text>
          )}
        </Card.Content>
      </Card>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {alerts.length === 0 ? (
        <View style={styles.center}>
          <IconButton
            icon="bell-outline"
            size={48}
            iconColor={theme.colors.primary}
          />
          <Text
            variant="bodyLarge"
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
          >
            No alerts yet
          </Text>
          <Text
            variant="bodySmall"
            style={{
              color: theme.colors.onSurfaceVariant,
              opacity: 0.7,
              textAlign: "center",
              marginTop: 4,
            }}
          >
            Create one to start tracking tee times.
          </Text>
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id!.toString()}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadAlerts();
              }}
            />
          }
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    marginBottom: 16,
    elevation: 1,
  },
  cardContent: {
    gap: 2,
  },
});