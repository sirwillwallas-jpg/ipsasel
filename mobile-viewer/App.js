import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { API_BASE_URL } from './src/config';

function formatDateLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return date.toLocaleDateString('es-VE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

function VisitCard({ visit }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardCode}>{visit.codigo_visita}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{visit.estatus}</Text>
        </View>
      </View>

      <Text style={styles.cardLine}>Hora: {String(visit.hora || '').slice(0, 5)}</Text>
      <Text style={styles.cardLine}>Tipo: {visit.tipo_visita}</Text>
      <Text style={styles.cardLine}>Nombre: {visit.nombre_completo || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Entidad: {visit.entidad || visit.nombre_entidad || 'No aplica'}</Text>
      <Text style={styles.cardLine}>Cédula/RIF: {visit.cedula_rif}</Text>
      <Text style={styles.cardLine}>Teléfono: {visit.telefono || 'No aplica'}</Text>
    </View>
  );
}

export default function App() {
  const [dateOptions, setDateOptions] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [error, setError] = useState('');

  const loadVisitsByDate = useCallback(async (isoDate) => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/visitas-por-fecha?fecha=${encodeURIComponent(isoDate)}`);
      if (!response.ok) {
        throw new Error('No se pudo consultar las visitas de la fecha seleccionada.');
      }

      const data = await response.json();
      setVisits(Array.isArray(data.visits) ? data.visits : []);
      setSelectedDate(isoDate);
    } catch (err) {
      setError(err.message || 'Error no esperado.');
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalendarDates = useCallback(async () => {
    setLoadingDates(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/visitas-eventos`);
      if (!response.ok) {
        throw new Error('No se pudo cargar el calendario.');
      }

      const data = await response.json();
      const events = Array.isArray(data.events) ? data.events : [];
      const uniqueDates = [...new Set(events.map((item) => String(item.start || '').slice(0, 10)).filter(Boolean))].sort();

      setDateOptions(uniqueDates);

      if (uniqueDates.length > 0) {
        const nextDate = selectedDate && uniqueDates.includes(selectedDate) ? selectedDate : uniqueDates[0];
        await loadVisitsByDate(nextDate);
      } else {
        setSelectedDate(null);
        setVisits([]);
      }
    } catch (err) {
      setError(err.message || 'Error no esperado.');
      setDateOptions([]);
      setVisits([]);
    } finally {
      setLoadingDates(false);
    }
  }, [loadVisitsByDate, selectedDate]);

  React.useEffect(() => {
    loadCalendarDates();
  }, [loadCalendarDates]);

  const headerSubtitle = useMemo(() => {
    if (!selectedDate) {
      return 'Sin fechas disponibles';
    }

    return `Fecha seleccionada: ${selectedDate}`;
  }, [selectedDate]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <Text style={styles.title}>Visor de Visitas</Text>
        <Text style={styles.subtitle}>{headerSubtitle}</Text>

        <View style={styles.actionsRow}>
          <Pressable style={styles.refreshButton} onPress={loadCalendarDates}>
            <Text style={styles.refreshText}>Actualizar</Text>
          </Pressable>
          <Text style={styles.apiHint}>API: {API_BASE_URL}</Text>
        </View>

        {loadingDates ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color="#1d4ed8" />
            <Text style={styles.loadingText}>Cargando fechas...</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateScroll}
            contentContainerStyle={styles.dateScrollContent}
          >
            {dateOptions.map((date) => {
              const isSelected = date === selectedDate;
              return (
                <Pressable
                  key={date}
                  onPress={() => loadVisitsByDate(date)}
                  style={[styles.dateChip, isSelected && styles.dateChipSelected]}
                >
                  <Text style={[styles.dateChipText, isSelected && styles.dateChipTextSelected]}>
                    {formatDateLabel(date)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color="#1d4ed8" />
            <Text style={styles.loadingText}>Cargando visitas...</Text>
          </View>
        ) : (
          <FlatList
            data={visits}
            keyExtractor={(item) => item.codigo_visita}
            renderItem={({ item }) => <VisitCard visit={item} />}
            contentContainerStyle={visits.length ? styles.listContent : styles.emptyContent}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>Sin resultados</Text>
                <Text style={styles.emptyText}>No hay visitas para la fecha seleccionada.</Text>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#edf4ff',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 12,
    fontSize: 14,
    color: '#334155',
  },
  actionsRow: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  refreshButton: {
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  refreshText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  apiHint: {
    flex: 1,
    textAlign: 'right',
    fontSize: 11,
    color: '#64748b',
  },
  dateScroll: {
    maxHeight: 52,
    marginBottom: 12,
  },
  dateScrollContent: {
    gap: 8,
    paddingRight: 8,
  },
  dateChip: {
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  dateChipSelected: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  dateChipText: {
    color: '#1e3a8a',
    fontWeight: '700',
  },
  dateChipTextSelected: {
    color: '#ffffff',
  },
  centerBlock: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#334155',
    fontSize: 13,
  },
  errorText: {
    marginBottom: 10,
    color: '#b91c1c',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 22,
    gap: 10,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    padding: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1e3a8a',
  },
  emptyText: {
    marginTop: 6,
    color: '#334155',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardCode: {
    flex: 1,
    color: '#0f172a',
    fontWeight: '800',
  },
  badge: {
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: '#1e3a8a',
    fontSize: 11,
    fontWeight: '700',
  },
  cardLine: {
    color: '#334155',
    marginTop: 2,
  },
});
