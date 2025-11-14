import React, { useEffect, useState } from "react";
import { View, FlatList, RefreshControl, StyleSheet } from "react-native";
import {
  Text,
  useTheme,
  Card,
  Button,
  ActivityIndicator,
  IconButton,
} from "react-native-paper";
import { supabase } from "@/lib/supabase";
import { getUserAlerts, deleteAlert } from "@/lib/api";
import { Alert as AlertType } from "@/types/alert";
import Toast from "react-native-toast-message";
import dayjs from "dayjs";

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
    }
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

  const renderItem = ({ item }: { item: AlertType }) => (
    <Card
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderRadius: 10 },
      ]}
    >
      <Card.Title
        title={`Course #${item.course_id}`}
        subtitle={`${item.holes} Holes`}
        right={(props) => (
          <IconButton
            {...props}
            icon="delete"
            onPress={() => handleDelete(item.id!)}
          />
        )}
      />
      <Card.Content>
        <Text
          style={{
            color: theme.colors.onSurfaceVariant,
            marginBottom: 4,
          }}
        >
          Date: {dayjs(item.date_from).format("MMM D, YYYY")}
        </Text>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>
          Time Window:{" "}
          {`${dayjs(item.start_time).format("h:mm A")} - ${dayjs(
            item.end_time
          ).format("h:mm A")}`}
        </Text>
      </Card.Content>
    </Card>
  );

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
          <Text
            variant="titleMedium"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            You don't have any alerts yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id!.toString()}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadAlerts} />
          }
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    marginBottom: 12,
    elevation: 2,
  },
});